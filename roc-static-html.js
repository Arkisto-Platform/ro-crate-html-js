#!/usr/bin/env node

const process = require('process');
const program = require('commander');
const fs = require('fs-extra');
const path = require('path');
const ROCrate = require("ro-crate").ROCrate;
const _ = require("lodash");
const {segmentPath, getLink} = require("./lib/rendering");
const {renderPage} = require('./lib/display');
const {DisplayableItem} = require('./lib/displayable');
const GeoJSON = require("geojson");
const Preview = require("./lib/ro-crate-preview");
const HtmlFile = require("./lib/ro-crate-preview-file");



const CratePruner = require('./lib/prune-crate');


program
  .version("0.1.0")
  .description(
    "Extracts data from a spreadsheet to make an RO crate"
  )
  .arguments("<d>")
  .option("-c, --config [conf]", "configuration file")
  .option("-r, --output-path [rep]", "Directory into which to write output", null)
  .action((d) => {crateDir = d})


program.parse(process.argv);
const outPath = program.outputPath ?  program.outputPath : crateDir;

async function makeRepo(outPath) {
    await fs.mkdirp(outPath);
  }


  

function indexByType(crate, config) {
    const types = {}
    for (let item of crate.getGraph()) {
        if (!(item["@id"] === "./" || item["@id"].match(/^ro-crate-metadata.json$/))){
            for (t of crate.utils.asArray(item["@type"])) {
                if (config.collectionTypes.includes(t)) {
                    if (!types[t]) {
                        types[t] = [item];
                    } else {
                        types[t].push(item);
                    }
                }
            }
        }
    }
    return types;
}


async function main(file) {
    repo = await makeRepo(outPath);
    const config = JSON.parse(await fs.readFile(program.config));
    // load the crate
    const crate = new ROCrate(JSON.parse(await fs.readFile(path.join(crateDir, "ro-crate-metadata.json"))));
    crate.index();
    crate.addBackLinks();
    repoRoot = crate.getRootDataset();
    // Need to have context loaded
    await crate.resolveContext();

    const Pruner = new CratePruner(_.clone(crate), _.clone(config));
    const repoCrate = Pruner.prune(repoRoot, _.clone(config));
    repoCrate.context = crate.context;
    repoCrate.index();
    repoRoot = repoCrate.getRootDataset();    
    repoRoot.hasPart = [];
    repoCrate._relPath = "./";


    const types = indexByType(crate, config);
    
    for (let type of Object.keys(types)) {
        const collection = 
                {"@id": `#type:${type}`,
                "@type": "RepositoryCollection",
                "name" : `${type} Collection`,
                "hasMember": []

            }
        repoCrate.addItem(collection);
        repoRoot.hasPart.push({"@id": collection["@id"]});

        for (let item of types[type]) {
            const Pruner1 = new CratePruner(_.clone(crate), _.clone(config));
            const itemCrate = Pruner1.prune(item);
            
            itemCrate.context = crate.context;
            const itemCrateRoot = itemCrate.getRootDataset();
            //itemCrateRoot["@reverse"] = []; 
            itemCrateRoot.name = item.name;
            itemCrate._relPath = segmentPath(item["@id"]);
            itemCrate._dirPath = path.join(outPath, itemCrate._relPath)
            itemCrate.addBackLinks();
            if (item.name === "VICTORIA") {
                console.log(item);
            }

            // Paths and directory setup
            await fs.mkdirp(itemCrate._dirPath);
            itemCrate._htmlpath = path.join(itemCrate._dirPath, "ro-crate-preview.html");
            itemCrate._relHtmlpath = path.join(itemCrate._relPath, "ro-crate-preview.html");
            
            // Make  displayable Item
            const dispItem = new DisplayableItem(itemCrate, item["@id"], config);
            dispItem.relPath = getLink(item, repoCrate);
            var template;
            if (config.types[type] && config.types[type].template){
                template = require( path.join(process.cwd(), path.dirname(program.config), config.types[type].template));
            } else {
                template = renderPage;
            }
            if (config.types[type] && config.types[type].findPlaces){
                findPlaces = require( path.join(process.cwd(), path.dirname(program.config), config.types[type].findPlaces));
                places = findPlaces(dispItem);
            } else {
                places = [];
            }
            if (places.length > 0) {
                const placeDir = path.join(outPath, "_GeoJSON", type);
                await fs.mkdirp(placeDir);
                const jsonFile = GeoJSON.parse(places, {Point: ['latitude', 'longitude']})
                const jsonString = JSON.stringify(jsonFile,null,2)
                const placesFile = path.join(placeDir, item["@id"].replace(/\W/g,"_")+".geo.json");
                await fs.writeFile(placesFile, jsonString);
                itemCrate.addItem({
                    "@id": placesFile,
                    "@type": "File",
                    "name": `GeoJSON for ${item["@id"]}`,
                    "encodingFormat": "geoJSON-TODO"
                })
                const i = itemCrate.getItem(item["@id"]);
                const part = itemCrate.utils.asArray(i.hasFile)
                part.push({"@id": placesFile});
                i.hasFile = part;
               
            }
            // TODO - have to make a second DI here cos places uses DI instead of a crate & item - probably should change that
            
            const dispItem1 = new DisplayableItem(itemCrate, item["@id"], config);
            dispItem1.relPath = getLink(item, repoCrate);
            const html = template(dispItem1, config, __dirname, places);
            
            /*
            Just testing ...
           const preview = new Preview(crate);
           const f = new HtmlFile(preview);
            const html = await f.render("http://localhost:8082/lib/crate.js");
            */
           
            await fs.writeFile(path.join(itemCrate._dirPath, "ro-crate-metadata.json"), JSON.stringify(itemCrate.json_ld, null, 2))
            await fs.writeFile(itemCrate._htmlpath, html)

            // Add item to relevant collection
            collection.hasMember.push({"@id": item["@id"]});
            repoCrate.addItem({"@id": item["@id"], "name": item.name, "@type": type});

        }
    }
    const dispItem = new DisplayableItem(repoCrate, "./", config);
    const html = renderPage(dispItem, config);
    await fs.writeFile(path.join(outPath, "ro-crate-preview.html"), html);
    await fs.mkdirp(path.join(outPath, "ro-crate-preview_files/assets"));
    //await fs.copyFile(path.join(__dirname, "assets","tailwind",  "tailwind.css"), path.join(outPath, "ro-crate-preview_files/assets/tailwind.css"));
    //await fs.copyFile(path.join(__dirname, "assets", "tailwind", "site.css"), path.join(outPath, "ro-crate-preview_files/assets/site.css"));


}

main(crateDir);








//console.log(module);


