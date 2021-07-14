const events = require('events');
const search = module.exports = new events.EventEmitter();

const types = {
    "screen-scraper": require("./searchers/screen-scraper"),
    "json-api": require("./searchers/json-api")
};

let providers = {};
search.providers = [];

const request = require("request");

//==============

//expose list and item methods - pass straight to search type
["list", "item"].forEach((fnName) => {
    search[fnName] = (data, callback) => {

        let p = providers[data.provider];
        if (!p)
            return callback("Missing provider: " + data.provider);

        let type = types[p.type];
        if (!type)
            return callback("Invalid type");

        type[fnName](p, data, callback);
    };
});

//==============

search.setproviders = (data, callback) => {
    if (!data.url)
        return callback("Missing url");
    request.get(data.url, (err, httpResponse, body) => {
        if (err)
            return callback("Failed to load: " + data.url);
        try {
            let newProviders = JSON.parse(body);
            //expose only the "names" to the frontend
            let names = {};
            for (let id in newProviders) {
                let p = newProviders[id];
                names[id] = p.name;
            }
            providers = newProviders;
            search.providers = names;
            search.emit("update");
            console.log("loaded search providers: %s", Object.keys(names).join(", "));
            callback(null, names);
        } catch (err) {
            return callback("Invalid JSON");
        }
    });
};

const url = process.env.SEARCH_PROVIDERS_URL;
if (url) search.setproviders({url: url}, (err, p) => {
    if (err) console.error("Failed to load search providers from: %s (%s)", url, err);
});

