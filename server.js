//load server config
const config = require("./config.json");
//apply defaults from env
for(let k in config) {
	if(k in process.env) {
		config[k] = process.env[k];
	}
}

//load submodules
const search = require("./lib/search");
const torrents = require("./lib/torrents");
const backend = require("./lib/backend");
const ws = require("./lib/ws");

const basicAuth = require('basic-auth-connect');
const bodyParser = require('body-parser');

const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const port = parseInt(process.argv[2], 10) ||
			process.env.PORT ||
			process.env.OPENSHIFT_NODEJS_PORT ||
			3000;
const host = process.env.HOST ||
			process.env.OPENSHIFT_NODEJS_IP ||
			"0.0.0.0";

//global auth
const user = process.env.AUTH_USER || 'admin';
const password = process.env.AUTH_PASSWORD;
if(password)
	app.use(basicAuth(user, password));

//hook http server
ws.install(server);

//all requests have JSON body
app.use(bodyParser.json());

//convert all of the given module's
//exposed functions into API endpoints
function api(name, module) {
	Object.keys(module).forEach(key => {
		let fn = module[key];
		if(typeof fn !== "function")
			return;
		//dont call modules with request/response,
		//instead call with 'body' and 'callback(err, data)'
		const endpoint = '/api/'+name+'/'+key;
		// console.log("POST %s -> %s.%s", endpoint, name, key);
		app.post(endpoint,  (req, res) => {
			fn(req.body, (err, data) => {
				if(err) {
					res.status(400).send(err);
				} else {
					res.send(data || "OK");
				}
			});
		});
	});
}

//use all module methods as JSON POST endpoints
api('search', search);
api('torrents', torrents);

//TODO(@jpillora) in future, some storage backends may need
//custom APIs

//disallow crawling
app.get('/robots.txt', (req, res) => {
	res.send("User-agent: *\nDisallow: /");
});

//modify configuration
// app.post('/config', function(req, res) {
// 	if(!req.body)
// 		return res.status(400).send("No body");
// 	var changed = false;
// 	for(var k in req.body) {
// 		var v = req.body[k];
// 		if(k in config && config[k] !== v) {
// 			config[k] = v;
// 			changed = true;
// 		}
// 	}
// 	if(changed) {
// 		update();
// 	}
// });

//expose static files
app.use('/', express.static(__dirname + '/static'));

let storedFiles = {};

//broadcast state on "update"
const update = (newFiles) => {
	//optionally update stored files
	if(newFiles)
		storedFiles = newFiles;
	//broadcast state
	ws.broadcast({
		config: config,
		providers: search.providers,
		torrents: torrents.list,
		filesDownloading: torrents.filesDownloading,
		uploads: storedFiles
	});
};
search.on("update", update);
torrents.on("update", update);

//periodically scan for new stored files
function list() {
	backend.list((err, files) => {
		if(!err) update(files);
	});
}
setInterval(list, 15*60*1000);
list();

server.on("error", (err) => {
	switch(err.code) {
		case "EADDRINUSE":
			console.error("Port %s is currently in use", port);
			break;
		default:
			console.error("Failed to listen on %s:%s (%s)", host, port, err.toString());
	}
	process.exit(1);
});

//listen!
server.listen(port, host, () => {
	console.log("listening on %s:%s...", host, port);
});
