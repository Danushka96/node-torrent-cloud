const events = require('events');
const torrents = module.exports = new events.EventEmitter();

const async = require('async');
const parse = require('parse-torrent');
const Archive = require('zip-stream');
const request = require('request');
const torrentStream = require('torrent-stream');

const File = require("./file");
const backend = require('./backend');

torrents.filesDownloading = 0;
let list = torrents.list = [];

//=============
// every second, check the status of all active torrents

setInterval(() => {
    let changed = false;

    let filesDownloading = 0;

    for (let i = 0; i < list.length; i++) {
        let t = list[i];

        if (!t.$engine)
            continue;

        //check torrent speed
        let swarm = t.$engine.swarm;

        let status = {
            down: swarm.downloaded,
            downps: swarm.downloadSpeed(),
            up: swarm.uploaded,
            upps: swarm.uploadSpeed()
        };

        for (let k in status)
            if (status[k] !== t.status[k])
                changed = true;

        if (t.zipping)
            filesDownloading++;

        //check file status
        t.files.forEach((f) => {
            if (f.uploading)
                filesDownloading++;
        });
        t.status = status;
    }

    if (torrents.filesDownloading !== filesDownloading) {
        torrents.filesDownloading = filesDownloading;
        changed = true;
    }

    if (changed)
        torrents.emit("update");
}, 1000);

//=============


const fs = require("fs");
const rm = require("rimraf");
const path = require("path");
const TMP_DIR = path.resolve("./tmp");
const TS_DIR = path.join(TMP_DIR, "torrent-stream");

//on start, reopen existing torrents
setTimeout(() => {
    if (!fs.existsSync(TS_DIR))
        return;
    let files = fs.readdirSync(TS_DIR);
    if (!files)
        return;
    files.filter((f) => {
        return /\.torrent$/.test(f);
    }).forEach((f) => {
        let buff = fs.readFileSync(path.join(TS_DIR, f));
        load(parse(buff), (err) => {
            if (!err)
                console.log("Restored torrent", f);
        });
    });
});


//=============
//helpers

const findTorrent = (hash) => {
    for (let i = 0; i < list.length; i++) {
        let t = list[i];
        if (t.hash === hash)
            return t;
    }
    return null;
};

const findFile = (torrent, path) => {
    for (let i = 0; i < torrent.files.length; i++) {
        let f = torrent.files[i];
        if (f.path === path)
            return f;
    }
    return null;
};

//=============

const load = (t, callback) => {
    if (!t)
        return callback("Invalid torrent");
    if (!t.infoHash)
        return callback("Missing hash");

    let torrent = findTorrent(t.infoHash);
    if (torrent)
        return callback("Torrent already exists");

    torrent = {
        $engine: null,
        hash: t.infoHash,
        name: t.name,
        trackers: t.announce,
        magnet: parse.toMagnetURI(t),
        files: [],
        status: {}
    };
    list.push(torrent);
    torrents.emit("update");

    //loaded, now open it
    torrents.open({hash: torrent.hash}, callback);
};

torrents.load = (data, callback) => {
    if (data.magnet) {
        load(parse(data.magnet), callback);
    } else if (data.torrent) {
        request({
            method: "GET",
            url: data.torrent,
            gzip: true,
            encoding: null //buffer!
        }, (err, resp, body) => {
            if (err)
                return callback("Invalid URL");
            let t;
            try {
                t = parse(body);
            } catch (e) {
                return callback("Failed to parse torrent");
            }
            load(t, callback);
        });
    } else {
        return callback("Invalid request");
    }
};

torrents.open = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Torrent missing");
    if (torrent.$engine)
        return callback("Torrent already open");

    //dont wait - open torrent stream, mark openning and callback
    let engine = torrentStream(torrent.magnet, {
        connections: 100,
        uploads: 0, //TODO should upload, though we can be highly CPU/mem bound
        tmp: TMP_DIR,
        verify: true,
        dht: true
    });

    torrent.$engine = engine;
    torrent.openning = true;
    torrents.emit("update");
    callback(null);

    engine.on('error', (err) => {
        //TODO destroy torrent
        console.error("torrent '%s' error: %s", torrent.name, err);
    });

    engine.on('ready', () => {
        //overwrite magnet name with real name
        torrent.name = engine.torrent.name;
        torrent.files = engine.files.map((f, i) => {
            return new File(f, i, torrent);
        });
        torrent.openning = false;
        torrent.open = true;
        torrents.emit("update");
    });
};

torrents.close = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Torrent missing");
    if (!torrent.$engine)
        return callback("Torrent not open");

    torrent.$engine.destroy(() => {

        //ensure all files are stopped
        if (torrent.files) {
            torrent.files.forEach((f) => {
                f.cancel();
            });
        }

        torrent.files = null;
        torrent.open = false;
        torrent.$engine = null;
        torrents.emit("update");
        callback(null);
    });
};

torrents.remove = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Torrent missing");
    if (torrent.$engine)
        return callback("Torrent is still open");
    let i = list.indexOf(torrent);
    list.splice(i, 1);
    torrents.emit("update");

    //clear torrent files and torrent
    rm(path.join(TS_DIR, torrent.hash), (err) => {
        if (err) console.log("failed to delete: %s", torrent.hash);
    });
    rm(path.join(TS_DIR, torrent.hash + ".torrent"), (err) => {
        if (err) console.log("failed to delete: %s.torrent", torrent.hash);
    });

    callback(null);
};

torrents.downloadFile = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Missing torrent");
    let file = findFile(torrent, data.path);
    if (!file)
        return callback("Missing file");
    if (file.downloading)
        return callback("Already downloading");

    //callback to user early since uploads can take hours...
    //user receives updates via websockets
    callback(null);
    file.uploading = true;
    torrents.emit("update");

    //pass copy of file to backend
    backend.upload({
        path: file.path,
        length: file.length,
        createReadStream: file.createReadStream.bind(file)
    }, (err) => {
        file.uploading = false;
        //receive result from backend
        if (err && err !== "cancelled") {
            file.downloadError = "Backend Error";
            torrents.emit("update");
            return console.error("backend error: ", err);
        }
        torrents.emit("update");

        //success, now re-list
        backend.list((err, files) => {
            if (err) return console.error("failed to list");
            torrents.emit("update", files);
        });
    });
};

torrents.cancelFile = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Missing torrent");
    let file = findFile(torrent, data.path);
    if (!file)
        return callback("Missing file");
    if (!file.downloading)
        return callback("Not downloading");

    let success = file.cancel();
    callback(success ? null : "Failed to close file");
};


torrents.zipAll = (data, callback) => {
    let torrent = findTorrent(data.hash);
    if (!torrent)
        return callback("Missing torrent");

    let files = torrent.files;

    let archive = new Archive();

    archive.on('error', (err) => {
        console.error("zip error:", err);
    });

    async.series(files.map((f, i) => {
        return (cb) => {
            archive.entry(f.createReadStream(), {name: f.path}, (err) => {
                if (err)
                    return cb(err);
                cb(null);
            });
        };
    }), (err) => {
        if (err) {
            torrent.zipping = false;
            torrents.emit("update");
            return console.error("zip archive error:", err);
        }
        archive.finish();
    });

    torrent.zipping = true;
    torrents.emit("update");

    //callback to user early since uploads can take hours...
    //user receives updates via websockets
    callback(null);

    //pass zip stream to backend
    backend.upload({
        path: torrent.name + ".zip",
        length: files.reduce((len, f) => {
            return len + f.length;
        }, 0),
        createReadStream: () => {
            return archive;
        }
    }, (err) => {
        torrent.zipping = false;
        torrents.emit("update");
        if (err) {
            return console.error("zip upload error:", err);
        }
        backend.list((err, files) => {
            if (err) return console.error("failed to list");
            torrents.emit("update", files);
        });
    });
};

torrents.trash = (data, callback) => {

    if (!data.path)
        return callback("Missing path");

    backend.remove(data.path, (err) => {
        if (err) return callback("Failed to trash: " + err);

        backend.list((err, files) => {
            if (err) return callback("Failed to list: " + err);
            torrents.emit("update", files);
            callback(null);
        });
    });
};
