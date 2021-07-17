//load submodules
const search = require("./lib/search");
const torrents = require("./lib/torrents");
const backend = require("./lib/google-drive");
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
	Object.keys(module).forEach(function(key) {
		var fn = module[key];
		if(typeof fn !== "function")
			return;
		//dont call modules with request/response,
		//instead call with 'body' and 'callback(err, data)'
		var endpoint = '/api/'+name+'/'+key;
		// console.log("POST %s -> %s.%s", endpoint, name, key);
		app.post(endpoint, function (req, res) {
			fn(req.body, function(err, data) {
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



//disallow crawling
app.get('/robots.txt', function(req, res) {
	res.send("User-agent: *\nDisallow: /");
});

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
		config: {},
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
	backend.list(function(err, files) {
		if(!err) update(files);
	});
}
setInterval(list, 15*60*1000);
list();

server.on("error", function(err) {
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
server.listen(port, host, function() {
	console.log("listening on %s:%s...", host, port);
});
