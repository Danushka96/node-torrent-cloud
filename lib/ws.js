const WebSocket = require('ws');

let json = "";
let data = null;
let conns = [];
let THROTTLE = 100;
let queued = false;

//send keepalive pings
setInterval(() => {
    conns.forEach((conn) => {
        conn.ssend("ping");
    });
}, 30 * 1000);

exports.install = (server) => {

    let ws = new WebSocket.Server({server: server});

    //this is required to allow the error to fall
    //through to the http server
    ws.on("error", () => {
    });

    ws.on('connection', function connection(conn) {
        //safe send
        conn.ssend = (str) => {
            if (this.readyState === WebSocket.OPEN)
                this.send(str);
        };
        //track all connections
        conns.push(conn);
        conn.on('close', () => {
            var i = conns.indexOf(conn);
            if (i >= 0) conns.splice(i, 1);
        });

        //noop (dont buffer data)
        conn.on('data', () => {
        });

        //initially sends the last broadcast
        if (json) conn.ssend(json);
    });
};

function broadcast() {
    queued = false;
    //don't include $properties
    json = JSON.stringify(data, (k, v) => {
        return typeof k === "string" && k[0] === "$" ? undefined : v;
    }, 2);
    conns.forEach((conn) => {
        conn.ssend(json);
    });
}

//actually just throttles to the private 'broadcast' function
exports.broadcast = (d) => {
    data = d; //always use latest broadcast
    if (queued) return;
    queued = true;
    setTimeout(broadcast, THROTTLE);
};
