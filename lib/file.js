const torrents = require("./torrents");
const stream = require("stream");
const through = require('./util/through');

//in effect, this controls the size of the download buffer,
//it gets cleared as the upload progresses (prevents buffering the entire download in memory)
let MIN_PIECE_SIZE = 50 * 1024 * 1024;//~50Mb

function File(f, index, torrent) {
    let file = this;
    file.$f = f;
    //TODO (@jpillora) make downloads actually fall at piece boundaries
    let pieceSize = torrent.$engine.torrent.pieceLength;
    file.$pieceSize = Math.ceil(MIN_PIECE_SIZE / pieceSize) * pieceSize;

    file.i = index;
    file.downloading = false;
    file.name = f.name;
    file.path = f.path;
    file.length = f.length;
}

File.prototype = {
    createReadStream: () => {
        let file = this;

        //already created
        if (file.$r)
            return file.$r;

        //start download
        file.downloadError = undefined;
        file.cancelled = undefined;
        file.downloading = true;
        file.downloadLength = 0;
        torrents.emit("update");

        let piece = 0;
        let piecing = false;
        let waiting = false;
        let r = file.$r = new stream.Readable();

        let read = r._read = () => {

            //completed early
            if (file.cancelled)
                return;

            //download one piece at a time
            if (piecing) {
                waiting = true;
                return;
            }
            piecing = true;
            waiting = false;

            let s = piece * file.$pieceSize;
            let e = Math.min(s + file.$pieceSize, file.length);

            //EOF completed successfully
            if (s >= file.length)
                return file.$complete();

            //pull the next piece
            let download = file.$d = file.$f.createReadStream({
                start: s,
                end: e - 1
            });

            //extract chunk, place in this file
            let monitor = through(function transform(b) {
                file.downloadLength += b.length;
                torrents.emit("update");
                r.push(b);
            }, function (flush) {
                //next piece
                piece++;
                piecing = false;
                if (waiting)
                    read();
                flush();
            });

            download.pipe(monitor);
        };

        return r;
    },
    cancel: () => {
        let file = this;
        //not open
        if (!file.$r || file.cancelled)
            return null;

        //attempt to close current download
        if (file.$d)
            file.$d.destroy();

        //close!
        file.cancelled = true;
        file.$complete("cancelled");
        file.$r = null;
        return true;
    },
    $complete: (err) => {
        let file = this;
        if (!file.downloading)
            return;
        file.downloading = false;
        torrents.emit("update");
        if (!file.$r)
            return;

        if (err)
            file.$r.emit("error", err);
        else
            file.$r.push(null);//EOF
    }
};

module.exports = File;
