const pup = require('puppeteer');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const { default: axios } = require('axios');
const { UserModel, BetModel, HistoryModel, FixtureModel } = require('./data');
const nodemailer = require('nodemailer');

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

// method that fetches fixture for a given date
const fetchFix = async (date) => {
    const browser = await pup.launch(config);
    const page = await browser.newPage();
    let url = "https://www.bbc.com/sport/football/scores-fixtures/" + date;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

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
    let articleArr = await leagueElement.$$('article.sp-c-fixture');
    let data = [];

    for (let index = 0; index < fixtureArr.length; index++) {
        let fixObj = { teamName: [], score: [], liveScore: [] };
        let fixture = fixtureArr[index];
        let article = articleArr[index];
        let teamsArr = await fixture.$$('span.qa-full-team-name');
        let scoreArr = await fixture.$$('span.sp-c-fixture__number--ft');
        let liveScoreArr = await fixture.$$('span.sp-c-fixture__number--live-sport');
        let liveTimeWrapper, liveTimeArr;
        if (liveScoreArr.length !== 0) {
            liveTimeWrapper = await article.$$('span.sp-c-fixture__status--live-sport');
            liveTimeArr = await liveTimeWrapper[0].$$('abbr');
            if (liveTimeArr[0] === undefined) liveTimeArr = await liveTimeWrapper[0].$$('span');
        }

        for (let team of teamsArr) {
            let teamHTML = await team.getProperty('innerHTML');
            let teamText = await teamHTML.jsonValue();
            fixObj.teamName.push(teamText);
        }
        if (scoreArr.length !== 0) {
            fixObj.liveScore = null;
            for (let score of scoreArr) {
                let scoreHTML = await score.getProperty('innerHTML');
                let scoreText = await scoreHTML.jsonValue();
                fixObj.score.push(scoreText)
            }
        }
        else if (liveScoreArr.length !== 0) {
            fixObj.score = null;
            for (let score of liveScoreArr) {
                let scoreHTML = await score.getProperty('innerHTML');
                let scoreText = await scoreHTML.jsonValue();
                fixObj.liveScore.push(scoreText);
            }
            let liveTimeHTML = await liveTimeArr[0].getProperty('innerHTML');
            let liveTimeText = await liveTimeHTML.jsonValue();
            fixObj.liveTime = liveTimeText;
        }
        else {
            fixObj.score = null;
            fixObj.liveScore = null;
            let timeText = await fixture.evaluate((fix) => {
                let ele = fix.querySelector('span.sp-c-fixture__number--time');
                if (ele) return ele.textContent;
                return null;
            })
            fixObj.time = timeText;
        }

        fixObj.date = date;

        data.push(fixObj)
    }


    await browser.close();
    return { success: true, data };
}

// method that calls fetchFix method for an array of dates and return an array of resolved promises
async function fetchFixArr(dateArr) {
    let data = await dateArr.map((date) => {
        return fetchFix(date);
    })

    return { success: true, data };
}

// method that fetches match results for a given month
const fetchRes = async (month) => {
    const browser = await pup.launch(config);
    const page = await browser.newPage();
    let url = "https://www.bbc.com/sport/football/premier-league/scores-fixtures/" + month + "?filter=results";
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });

    let data = [];
    let matchObj = {};



    let aLink = await page.$$(`a[href='/sport/football/premier-league/scores-fixtures/${month}?filter=results']`)

    if (aLink.length !== 0) await page.click(`a[href='/sport/football/premier-league/scores-fixtures/${month}?filter=results']`)

    let elementArr = await page.$$('div.qa-match-block');

    if (elementArr.length === 0) return { success: false, message: "no games in this month" };



    for (let ele of elementArr) {
        matchObj = {};
        matchObj.fixArr = [];
        let titleArr = await ele.$$('h3');
        let titleHTML = await titleArr[0].getProperty('innerHTML');
        let titleText = await titleHTML.jsonValue();

        let day = titleText.split(" ")[0].toUpperCase();
        if (day !== 'SATURDAY' && day !== 'SUNDAY') continue;

        let regEx = /\d+/g;
        let date = parseInt(titleText.match(regEx).join([]));
        let formatDate = Math.floor(date / 10).toString() + (date % 10).toString();
        formatDate = month + "-" + formatDate;
        matchObj.date = formatDate;

        let fixtureArr = await ele.$$('div.sp-c-fixture__wrapper');

        for (let fixture of fixtureArr) {
            let fixObj = { teamName: [], score: [] };
            let teamsArr = await fixture.$$('span.qa-full-team-name');
            let scoreArr = await fixture.$$('span.sp-c-fixture__number--ft');

            for (let team of teamsArr) {
                let teamHTML = await team.getProperty('innerHTML');
                let teamText = await teamHTML.jsonValue();
                fixObj.teamName.push(teamText);
            }

            if (scoreArr.length === 0) fixObj.score = null;
            else {
                for (let score of scoreArr) {
                    let scoreHTML = await score.getProperty('innerHTML');
                    let scoreText = await scoreHTML.jsonValue();
                    fixObj.score.push(scoreText);
                }
            }

            if (fixObj.score !== null) matchObj.fixArr.push(fixObj);
        }

        data.push(matchObj);
    }

    await browser.close();

    return { success: true, data }

}

// method that calls fetchRes method for an array of months and returns an array of resolved promises
async function fetchResArr(monthArr) {
    let data = await monthArr.map((month) => {
        return fetchRes(month);
    })

    return { success: true, data };
}

// router that either creates new user or loads already existing user data
router.post("/loadData", (req, res) => {

    const { userID, email } = req.body;
    let satDate = getMatchDates()[0];

    FixtureModel.findOne(
        {},
        (err, data) => {
            if (err) res.json({ success: false, err: err });
            let fixObj = data.fixtures;
            if (fixObj[satDate] === undefined) {
                fetchFixArr(getMatchDates()).then((resp) => {
                    Promise.all(resp.data).then(fixArr => {
                        fixObj[satDate] = fixArr;
                        console.log(data.fixtures)
                        //data.fixtures = fixObj;
                        FixtureModel.findOneAndUpdate(
                            {},
                            { $set: { fixtures: fixObj } },
                            { new: true },
                            (err, data) => {
                                if (err) res.json({ success: false, err: err });
                            }
                        )

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
                                        res.json({ success: true, data: { userData: data, fixture: fixArr } });

                                    })
                                }
                                else {
                                    let settle = settleScore(userID);
                                    if (settle.success === false) res.json({ success: false, err: settle.err });

                                    res.json({ success: true, data: { userData: (settle.data) ? settle.data.userData : data, fixture: fixArr } });
                                }
                            }
                        )
                    })
                })
            }
            else {
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
                                res.json({ success: true, data: { userData: data, fixture: fixObj[satDate] } });
                            })
                        }
                        else {
                            let settle = settleScore(userID);
                            if (settle.success === false) res.json({ success: false, err: settle.err });

                            res.json({ success: true, data: { userData: (settle.data) ? settle.data.userData : data, fixture: fixObj[satDate] } });
                        }
                    }
                )
            }
        }
    )

})

// router that esecutes betting on a match
router.post("/betOnMatch", (req, res) => {
    const { userID, teams, betScore, gameDate } = req.body;
    let satDate = getMatchDates()[0];

    FixtureModel.findOne(
        {},
        (err, data) => {
            if (err) res.json({ success: false, err: err });
            let fixObj = data.fixtures;
            if (fixObj[satDate] === undefined) {
                fetchFixArr(getMatchDates()).then((resp) => {
                    Promise.all(resp.data).then(fixArr => {
                        fixObj[satDate] = fixArr;
                        FixtureModel.findOneAndUpdate(
                            {},
                            { $set: { fixtures: fixObj } },
                            { new: true },
                            (err, data) => {
                                if (err) res.json({ success: false, err: err });
                            }
                        )
                        UserModel.findOne(
                            { userID: userID },
                            (err, data) => {
                                if (err) res.json({ success: false, err: err });
                                if (teamsInFix(teams, fixArr)) {

                                    let bet = new BetModel();
                                    bet.teams = teams;
                                    bet.betScore = betScore;
                                    bet.gameDate = gameDate;
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
            }
            else {
                UserModel.findOne(
                    { userID: userID },
                    (err, data) => {
                        if (err) res.json({ success: false, err: err });
                        if (teamsInFix(teams, fixObj[satDate])) {

                            let bet = new BetModel();
                            bet.teams = teams;
                            bet.betScore = betScore;
                            bet.gameDate = gameDate;
                            let { betData } = data;

                            betData.currentBet.push(bet);

                            UserModel.findOneAndUpdate(
                                { userID: userID },
                                { $set: { betData: betData } },
                                { new: true },
                                (err, data) => {
                                    if (err) res.json({ success: false, err: err });
                                    return res.json({ success: true, data: { userData: data, fixture: fixObj[satDate] } });
                                }
                            )
                        }
                        else res.json({ success: false, message: "no such match the coming weekend.", fixture: fixObj[satDate] })
                    }
                )
            }
        }
    )


})

// router that removes an existing bet
router.post("/removeBet", (req, res) => {
    const { userID, teams } = req.body;

    UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });

            let { betData } = data;
            let newCurrentBet = removeTeams(teams, betData.currentBet);

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
});

// router that updates existing bet on match
router.post("/updatebet", (req, res) => {
    const { userID, teams, betScore } = req.body;
    UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });

            let { betData } = data;
            let updatedBet = updateBet(teams, betScore, betData.currentBet);

            if (updatedBet === false) {
                res.json({ success: false, message: "no such bet exists." });
            }
            else {
                betData.currentBet = updatedBet;

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
});

// router that resets user's account
router.post("/reset", (req, res) => {
    const { userID } = req.body;
    UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });
            let newBetData = { currentBet: [], betHistory: [] };
            UserModel.findOneAndUpdate(
                { userID: userID },
                { $set: { betData: newBetData } },
                { new: true },
                (err, data) => {
                    if (err) res.json({ success: false, err: err });
                    return res.json({ success: true, data: { userData: data } });
                }
            )
        }
    )
})

// method that compares match result with bet score to figure out points won and update bet data
function settleScore(userID) {

    return UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) return { success: false, err: err };

            let { betData } = data;
            let dateArr = [];
            for (let bet of betData.currentBet) {
                if (dateArr.indexOf(bet.gameDate.slice(0, -3)) === -1) dateArr.push(bet.gameDate.slice(0, -3));
            }

            if (dateArr.length === 0) return { success: true, data: null };;

            return fetchResArr(dateArr).then((resp) => {
                Promise.all(resp.data).then(resArr => {
                    let flatRes = [];
                    for (let result of resArr) {
                        if (result.success === true) {
                            for (let matchGrp of result.data) {
                                for (let fix of matchGrp.fixArr) {
                                    fix.date = matchGrp.date;
                                    flatRes.push(fix);
                                }
                            }
                        }
                    }
                    let linkArr = resInBet(flatRes, betData.currentBet);

                    let newHistory = [];
                    let deleteIndex = [];
                    for (let link of linkArr) {
                        let history = new HistoryModel();
                        history.teams = flatRes[link[0]].teamName;
                        history.betScore = betData.currentBet[link[1]].betScore;
                        history.gameDate = flatRes[link[0]].date;
                        history.actualScore = flatRes[link[0]].score;
                        history.points = getPts(history.betScore, history.actualScore);
                        newHistory.push(history);
                        deleteIndex.push(link[1]);
                    }



                    if (newHistory.length !== 0) {
                        let newBetHistory = mergeHistory([...betData.betHistory], [...newHistory]);
                        let newCurrentBet = [];
                        betData.currentBet.forEach((bet, i) => {
                            if (deleteIndex.indexOf(i) === -1) newCurrentBet.push(bet);
                        })
                        let newBetData = { currentBet: newCurrentBet, betHistory: newBetHistory }
                        UserModel.findOneAndUpdate(
                            { userID: userID },
                            { $set: { betData: newBetData } },
                            { new: true },
                            (err, data) => {
                                if (err) return { success: false, err: err };
                                return { success: true, data: { userData: data } };
                            }
                        )
                    }
                    else return { success: true, data: null };
                })
            })

        }
    )
}

// method that inserts new bet history item in an ordered bet history array
function mergeHistory(betHistoryArr, newHistoryArr) {
    for (let newHistory of newHistoryArr) {
        if (betHistoryArr.length === 0) betHistoryArr.push(newHistory);
        else {
            for (let i = 0; i < betHistoryArr.length; i++) {
                if (newHistory.gameDate >= betHistoryArr[i].gameDate) {
                    betHistoryArr.splice(i, 0, newHistory);
                    break;
                }
                else if (i === betHistoryArr.length - 1) {
                    betHistoryArr.push(newHistory);
                    break;
                }
            }
        }
    }

    return betHistoryArr;
}

// method that returns the match result items that are also in user's current bet data
function resInBet(resArr, betArr) {
    let linkArr = [];

    resArr.forEach((match, i) => {
        betArr.forEach((bet, j) => {
            if (match.teamName[0] === bet.teams[0] && match.teamName[1] === bet.teams[1]) linkArr.push([i, j]);
        })
    })

    return linkArr;
}

// method that calculates points won by comparing bet score with match result
function getPts(betScore, actualScore) {
    if (betScore[0] === parseInt(actualScore[0]) && betScore[1] === parseInt(actualScore[1])) return 5;
    else if (
        (betScore[0] === betScore[1] && actualScore[0] === actualScore[1]) ||
        (betScore[0] > betScore[1] && actualScore[0] > actualScore[1]) ||
        (betScore[0] < betScore[1] && actualScore[0] < actualScore[1])
    ) return 2;
    else return 0;
}

// method that updates user's current bet data with new score
function updateBet(teams, score, betArr) {
    for (let i = 0; i < betArr.length; i++) {
        if (betArr[i].teams[0] === teams[0] && betArr[i].teams[1] === teams[1]) {
            betArr[i].betScore = score;
            return betArr;
        }
    }

    return false;
}

// method that removes a bet item from a users's current bet data
function removeTeams(teams, betArr) {
    for (let i = 0; i < betArr.length; i++) {
        if ((betArr[i].teams[0] === teams[0] && betArr[i].teams[1] === teams[1]) || (betArr[i].teams[0] === teams[1] && betArr[i].teams[1] === teams[0])) {
            betArr.splice(i, 1);
            return betArr;
        }
    }

    return false;
}

// method that checks if a matchup of teams is in a match fixture
function teamsInFix(teams, fixArr) {
    for (let fixObj of fixArr) {
        if (fixObj.success) {
            for (let fixture of fixObj.data) {
                if ((fixture.teamName[0] === teams[0] && fixture.teamName[1] === teams[1]) || (fixture.teamName[0] === teams[1] && fixture.teamName[1] === teams[0])) return true;
            }
        }
    }

    return false;
}

// a method that returns the date of the upcoming Saturday and Sunday
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

// a method that puts a date into YYYY-MM-DD format
function getDateStr(date) {
    let yearStr = date.getUTCFullYear().toString();
    let monthStr = Math.floor((date.getUTCMonth() + 1) / 10).toString() + ((date.getUTCMonth() + 1) % 10).toString();
    let dateStr = Math.floor(date.getUTCDate() / 10).toString() + (date.getUTCDate() % 10).toString();

    return yearStr + "-" + monthStr + "-" + dateStr;
}

/*
// this method is used to give access to a gmail account to send out price alert emails to users 
var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        type: 'OAuth2',
        user: process.env.USER,
        pass: process.env.PASS,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: process.env.REFRESH_TOKEN
    }
});

// this is the alert email template object
var mailOptions = {
    from: "111automail@gmail.com",
    to: "",
    subject: "",
    text: ""
}

// this method sends emails to users for price alert
function sendEmail() {
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log("lol", error);
        } else {
            console.log("Email sent: " + info.response);
        }
    });
}
*/


// launch our backend into a port
app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));