const request = require("request");
const cheerio = require("cheerio");
const $ = cheerio.load("");

const template = (str, data) => {
    return str.replace(/\{\s*(\w+)\s*\}/g, function (all, key) {
        return encodeURIComponent(data[key]);
    });
};

const load = (url, callback) => {
    request({
        method: "GET",
        url: url,
        gzip: true,
        headers: {
            //just a regular browser, nothing to see here...
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/40.0.2214.91 Safari/537.36"
        }
    }, (err, httpResponse, body) => {
        // require("fs").writeFileSync("./prototype/results.html", body);
        if (err)
            return callback("Failed to load: '" + url + "': " + err);
        let root = cheerio.load(body);
        root.find = root;
        callback(null, root);
    });
};

const val = (elem, selector) => {

    if (!elem.find)
        elem = $(elem);

    //regex selector?
    if (/^\/(.+)\/$/.test(selector)) {
        let re = new RegExp(RegExp.$1);
        //test against html
        if (re.test(elem.html()))
            return RegExp.$1.replace("&nbsp;", " ").replace("&#xA0;", " ");
        return "";
    }

    //attribute selector?
    let attr;
    selector = selector.replace(/^(.+)@(\w+)$/, (all, sel, a) => {
        attr = a;
        return sel;
    });

    let e = elem.find(selector);
    // console.log("selector '%s' [attr: %s] [results: %s]",  selector, attr, e ? e.length: null);
    if (!e || e.length === 0)
        return null;
    return attr ? e.attr(attr) : e.text();
};

//==========

exports.list = (p, data, callback) => {
    if (!data || !data.query)
        return callback("Missing query");

    let page = data.page || 1;

    let url = template(p.list.url, {
        page: page,
        zpage: page - 1,//zero-indexed page
        query: data.query
    });

    let origin = /(https?:\/\/[^\/]+)/.test(url) && RegExp.$1;
    if (!origin)
        return callback("Invalid URL");

    load(url, (err, root) => {
        if (err)
            return callback("Search provider could not reached");

        let items = root.find(p.list.items);

        // console.log("loaded %s, selector '%s' yeilds %s results",  url, p.list.items, items.length);

        let results = [];
        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            let missing = false;
            let result = {};
            for (let k in p.list.item) {
                let v = val(item, p.list.item[k]);
                //exclude items with missing values
                if (!v) {
                    missing = true;
                    break;
                }
                //url convert rela->abs
                if (k === "url" && v && v[0] === "/")
                    v = origin + v;
                //insert
                result[k] = v;
            }

            if (!missing)
                results.push(result);
        }

        callback(null, results);
    });
};

exports.item = (p, data, callback) => {

    if (!p.item)
        return callback("Provider cannot retrieve items");
    if (!data.url)
        return callback("Missing url");

    load(data.url, (err, root) => {
        if (err)
            return callback("Failed to load: " + data.url);

        let result = {};
        for (let k in p.item) {
            let v = val(root, p.item[k]);
            if (v) result[k] = v;
        }

        // console.log(data.url, result);
        callback(null, result);
    });
};
