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

// append /api for our http requests
app.use("/", router);

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

const fetchFix = async (date) => {
    const browser = await pup.launch(config);
    const page = await browser.newPage();
    let url = "https://www.bbc.com/sport/football/scores-fixtures/" + date;
    await page.goto(url, { waitUntil: 'networkidle0' });

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

    for (let index = 0; index < fixtureArr.length; index++) {
        let fixObj = { teamName: [], score: [] };
        let fixture = fixtureArr[index];
        let teamsArr = await fixture.$$('span.qa-full-team-name');
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
            let timeText = await fixture.evaluate((fix) => {
                let ele = fix.querySelector('span.sp-c-fixture__number--time');
                if (ele) return ele.textContent;
                return null;
            })
            fixObj.time = timeText;
        }

        data.push(fixObj)
    }



    return { success: true, data };
}


async function fetchFixArr(dateArr) {
    let data = await dateArr.map((date) => {
        return fetchFix(date);
    })

    return { success: true, data };
}


// fetchFixArr(dateA).then((res) => {
//     Promise.all(res.data).then(fixArr => {

//         console.log(JSON.stringify(fixArr, null, 4));
//     })
// })

router.post("/loadData", (req, res) => {

    const { userID, email } = req.body;

    fetchFixArr(getMatchDates()).then((resp) => {
        Promise.all(resp.data).then(fixArr => {
            UserModel.findOne(
                { userID: userID },
                (err, data) => {
                    if (err) res.json({ success: false, err: err });
                    if (!data) {
                        let data = new UserModel();
                        data.userID = userID;
                        data.email = email;
                        console.log("new data, data");
                        data.save(err => {
                            if (err) res.json({ success: false, err: err });
                            res.json({ success: true, data: { userData: data, fixture: fixArr.data } });

                        })
                    }
                    else {
                        res.json({ success: true, data: { userData: data, fixture: fixArr } });
                    }
                }
            )
        })
    })
})

router.post("/betOnMatch", (req, res) => {
    const { userID, teams, betScore } = req.body;

    fetchFixArr(getMatchDates()).then((resp) => {
        Promise.all(resp.data).then(fixArr => {

            UserModel.findOne(
                { userID: userID },
                (err, data) => {
                    if (err) res.json({ success: false, err: err });
                    if (teamsInFix(teams, fixArr)) {

                        let bet = new BetModel();
                        bet.teams = teams;
                        bet.betScore = betScore;

                        let { betData } = data;

                        betData.currentBet.push(bet);

                        UserModel.findOneAndUpdate(
                            { userID: userID },
                            { $set: { betData: betData } },
                            { new: true },
                            (err, data) => {
                                if (err) res.json({ success: false, err: err });
                                return res.json({ success: true, data: { userData: data, fixture: fixArr } });
                            }
                        )
                    }
                    else res.json({ success: false, message: "no such match the coming weekend.", fixture: fixArr })
                }
            )
        })
    })
})

router.post("/removeBet", (req, res) => {
    const { userID, teams } = req.body;

    UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });

            let { betData } = data;
            let newCurrentBet = teamsInBet(teams, betData.currentBet);

            if (newCurrentBet === false) {
                res.json({ success: false, message: "no such bet exists." })
            }
            else {
                betData.currentBet = newCurrentBet;

                UserModel.findOneAndUpdate(
                    { userID: userID },
                    { $set: { betData: betData } },
                    { new: true },
                    (err, data) => {
                        if (err) res.json({ success: false, err: err });
                        return res.json({ success: true, data: { userData: data } });
                    }
                )
            }
        }
    )
})

function teamsInBet(teams, betArr) {
    for (let i = 0; i < betArr.length; i++) {
        if ((betArr[i].teams[0] === teams[0] && betArr[i].teams[1] === teams[1]) || (betArr[i].teams[0] === teams[1] && betArr[i].teams[1] === teams[0])) {
            betArr.splice(i, 1);
            return betArr;
        }
    }

    return false;
}

function teamsInFix(teams, fixArr) {
    for (fixObj of fixArr) {
        if (fixObj.success) {
            for (fixture of fixObj.data) {
                if ((fixture.teamName[0] === teams[0] && fixture.teamName[1] === teams[1]) || (fixture.teamName[0] === teams[1] && fixture.teamName[1] === teams[0])) return true;
            }
        }
    }

    return false;
}

function getMatchDates() {
    let date = new Date();
    let day = date.getUTCDay();
    let diff = (day === 0) ? -1 : 6 - day;
    let gameDay1 = new Date(date.getTime() + (diff * 24 * 3600 * 1000));
    let gameDay2 = new Date(date.getTime() + ((diff + 1) * 24 * 3600 * 1000));
    let dateStr1 = getDateStr(gameDay1);
    let dateStr2 = getDateStr(gameDay2);

    return [dateStr1, dateStr2];
}

function getDateStr(date) {
    let yearStr = date.getUTCFullYear().toString();
    let monthStr = Math.floor((date.getUTCMonth() + 1) / 10).toString() + ((date.getUTCMonth() + 1) % 10).toString();
    let dateStr = Math.floor(date.getUTCDate() / 10).toString() + (date.getUTCDate() % 10).toString();

    return yearStr + "-" + monthStr + "-" + dateStr;
}
// launch our backend into a port
app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));