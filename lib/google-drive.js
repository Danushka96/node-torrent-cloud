const fs = require('fs');
const readline = require('readline');
const async = require("async");
const {google} = require('googleapis');

exports.vars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const TOKEN_PATH = 'token.json';

exports.init = function () {
    authorize((client) => console.log("Google Auth success"))
}

exports.list = function (callback) {
    callback(null, {
        "path1": {
            length: 0,
            url: ""
        },
    });
}

exports.upload = function (torrentFile, callback) {
    authorize((client) => upload(client, torrentFile, callback));
};

exports.remove = function (path, callback) {
    callback(null);
};

function folderExists(name, drive, callback) {
    let pageToken = null;
    drive.files.list({
        q: `name='${name}' and mimeType='application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name)',
        spaces: 'drive',
        pageToken: pageToken
    }, (err, res) => {
        if (err) {
            console.error(err);
            callback(err)
        } else {
            if (res.data.files.length > 0) {
                callback(true);
            } else {
                callback(false);
            }
        }
    })
}

function mkdir(drive, name) {
    let fileMeta = {
        'name': name,
        'mimeType': 'application/vnd.google-apps.folder'
    }

    drive.files.create({
        resource: fileMeta,
        fields: 'id'
    }, (err, file) => {
        if (err) {
            console.error(err);
        }
    });
}

function upload(auth2Client, torrentFile, callback) {
    let dirs = torrentFile.path.split("\\");
    let name = dirs[0];
    const drive = google.drive({version: 'v3', auth: auth2Client});

    folderExists(name, drive, (res) => {
        if (res === true) {
            console.log("Folder Exists");
        } else {
            mkdir(drive, name)
        }
    });


    let fileMetadata = {
        name
    };
    let stream = torrentFile.createReadStream();
    let media = {
        body: stream
    };

    drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id'
    }, function (err, file) {
        if (err) {
            // Handle error
            console.error(err);
        } else {
            console.log('File Id: ', file.id);
        }
    });


    callback(null);

    //
    // function upload(dir) {
    //     var upload = storage.root.upload({
    //         name: name,
    //         size: torrentFile.length,
    //         target: dir
    //     });
    //
    //     var stream = torrentFile.createReadStream();
    //
    //     stream.pipe(upload);
    //
    //     upload.on("error", function(err) {
    //         callback(err);
    //     });
    //
    //     //callback when stream has been fully uploaded
    //     upload.on("complete", function(f) {
    //         console.log("uploaded", f.name);
    //         callback(null);
    //     });
    // }
}

function authorize(callback) {
    const redirect_uris = 'http://localhost:8081/callback'
    const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirect_uris);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getAccessToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

function getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}
