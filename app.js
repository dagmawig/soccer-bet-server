const pup = require('puppeteer');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const { default: axios } = require('axios');
const { UserModel, BetModel, HistoryModel } = require('./data');

require('dotenv').config();

// allow app request from any domain
app.use(cors({ origin: "*" }));

const API_PORT = 3001;

const router = express.Router();

// bodyParser, parses the request body to be a readable json format
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

mongoose.connect(process.env.MONGO_URI, {});

//requirement to use findOneAndUpdate method
//mongoose.set("useFindAndModify", false);

let db = mongoose.connection;

// connecting to DB
db.once("open", () => console.log("connected to database"));

// checks if connection with the database is successful
db.on("error", console.error.bind(console, "MongoDB connection error:"));

const config = {
    headless: true,
    devtools: false
}

const doScrap = async () => {
    const browser = await pup.launch(config);
    const page = await browser.newPage();

    await page.goto('https://www.bbc.com/sport/football/scores-fixtures/2022-01-02', { waitUntil: 'networkidle0' });

    let elementArr = await page.$$('div.qa-match-block');

    if (elementArr.length === 0) return { success: false, message: "no games on this date" };

    let leagueElement;

    for (var ele of elementArr) {
        let h3Text = await ele.$eval('h3', (res) => {
            return res.innerHTML;
        })
        if (h3Text === 'Premier League') {
            leagueElement = ele;
            break;
        }
    }

    if (leagueElement === undefined) return { success: false, message: "no games on this date" };

    let fixtureArr = await leagueElement.$$('div.sp-c-fixture__wrapper');

    let data = [];

    for (let fixture of fixtureArr) {
        let fixObj = { teamName: [], score: [] };
        let teamsArr = await fixture.$$('abbr');
        let scoreArr = await fixture.$$('span.sp-c-fixture__number--ft')

        for (let team of teamsArr) {
            let teamHTML = await team.getProperty('innerHTML');
            let teamText = await teamHTML.jsonValue();
            fixObj.teamName.push(teamText);
        }
        if (scoreArr.length !== 0) {
            for (let score of scoreArr) {
                let scoreHTML = await score.getProperty('innerHTML');
                let scoreText = await scoreHTML.jsonValue();
                fixObj.score.push(scoreText)
            }
        }
        else {
            fixObj.score = null;
            let timeText = await fixture.evaluate(() => {
                let ele = document.querySelector('span.sp-c-fixture__number--time');
                if (ele) return ele.textContent;
                return null;
            })
            fixObj.time = timeText;
        }

        data.push(fixObj)
    }

    return data;
}

// doScrap().then((res) => {
//     console.log(res);
// })


