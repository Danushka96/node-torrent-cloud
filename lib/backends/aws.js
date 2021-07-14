const through = require('../util/through');
const mime = require('mime');
const async = require('async');
const AWS = require("aws-sdk");

let s3;
let bucket;
let region;

let CONCURRENT_FILES = 1;
let CONCURRENT_UPLOADS = 2;
let MIN_MULTIPART = 5 * 1024 * 1024;//~5Mb

exports.vars = ["AWS_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY", "AWS_SECRET_KEY"];

//=============

const createMultipart = (file, callback) => {
    s3.createMultipartUpload({
        Bucket: bucket,
        Key: file.path,
        ContentType: mime.lookup(file.path),
        ACL: "public-read"
    }, (err, data) => {
        if (err)
            return callback("Failed to create multipart upload");
        if (!data.UploadId)
            return callback("Missing multipart upload ID");

        //set upload info ($ == dont JSONify)
        file.uploadId = data.UploadId;
        file.etags = [];

        //multipart created, upload parts
        callback(null, file);
    });
};

//upload worker function
const uploadPart = (file, u, callback) => {

    //cancelled
    if (!file.uploadId)
        return callback(null);

    s3.uploadPart({
        Bucket: bucket,
        Key: file.path,
        PartNumber: u.part + 1,
        UploadId: file.uploadId,
        Body: u.buff
    }, (err, data) => {
        if (err)
            return callback(err);
        file.etags[u.part] = data.ETag;
        callback(null);
    });
};

const uploadParts = (file, callback) => {

    //this file's uploads queue
    let uploads = async.queue(uploadPart.bind(null, file), CONCURRENT_UPLOADS);

    let stream = file.createReadStream();

    //upload errored/cancelled!
    stream.on("error", (err) => {
        //attempt abort
        s3.abortMultipartUpload({
            Bucket: bucket,
            Key: file.path,
            UploadId: file.uploadId
        }, (err) => {
            if (err) console.error("failed to abort multipart", err);
        });

        //signal closed
        file.uploadId = null;
        uploads.kill();
        //upload cancelled!
        callback(err);
    });

    let buff = new Buffer(0);
    let part = 0;

    stream.pipe(through(function transform(data, next) {
        buff = Buffer.concat([buff, data]);
        //to prevent backlog, only ask for the 'next'
        //data when we're not uploading
        if (buff.length >= MIN_MULTIPART) {
            let b = buff.slice(0, MIN_MULTIPART);
            buff = buff.slice(MIN_MULTIPART);
            uploads.push({buff: b, part: part++}, next);
        } else {
            next();
        }
    }, function end(done) {
        done();
        //last part?
        if (buff.length > 0)
            uploads.push({buff: buff, part: part++});
        //download complete, prepare callback on upload complete
        uploads.drain = () => {
            callback(null, file);
        };
    }));
};

const completeMultipart = (file, callback) => {
    s3.completeMultipartUpload({
        Bucket: bucket,
        Key: file.path,
        UploadId: file.uploadId,
        MultipartUpload: {
            Parts: file.etags.map((e, i) => {
                return {ETag: e, PartNumber: i + 1};
            })
        }
    }, callback);
};

//=============

const uploadSinglePartFile = (file, callback) => {
    let stream = file.createReadStream();
    let cancelled = false;

    stream.on("error", (err) => {
        cancelled = true;
        callback(err);
    });

    let buff = new Buffer(0);
    stream.pipe(through(function transform(b) {
        buff = Buffer.concat([buff, b]);
    }, function end(done) {
        if (cancelled)
            return;
        s3.putObject({
            Bucket: bucket,
            Key: file.path,
            Body: buff,
            ContentType: mime.lookup(file.path),
            ContentLength: buff.length,
            ACL: 'public-read'
        }, callback);
    }));
};

//=============

const upload = (file, callback) => {
    if (file.length <= 0)
        return callback("Invalid length");

    if (file.length < MIN_MULTIPART)
        //singlepart upload
        uploadSinglePartFile(file, callback);
    else
        //multipart upload - begin multipart flow
        async.waterfall([
            createMultipart.bind(null, file),
            uploadParts,
            completeMultipart
        ], callback);
};

let queue = async.queue(upload, CONCURRENT_FILES);

//=============

exports.upload = (file, callback) => {
    queue.push(file, callback);
};

//=============

exports.list = (callback) => {
    s3.listObjects({Bucket: bucket}, (err, data) => {
        if (err)
            return callback(err);
        let files = {};
        data.Contents.forEach((o) => {
            files[o.Key] = {
                length: o.Size,
                url: 'https://s3-' + region + '.amazonaws.com/' + bucket + '/' + o.Key
            };
        });
        callback(null, files);
    });
};

//=============

exports.remove = (path, callback) => {
    s3.deleteObject({Bucket: bucket, Key: path}, callback);
};

//=============

exports.init = (config) => {
    bucket = config.AWS_BUCKET;
    region = config.AWS_REGION;

    //init s3
    s3 = new AWS.S3({
        accessKeyId: config.AWS_ACCESS_KEY,
        secretAccessKey: config.AWS_SECRET_KEY,
        region: config.AWS_REGION
    });
};
