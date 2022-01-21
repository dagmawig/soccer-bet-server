const pup = require('puppeteer');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const { default: axios } = require('axios');
const { UserModel, BetModel, HistoryModel } = require('./data');
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
        let fixObj = { teamName: [], score: [], liveScore: [] };
        let fixture = fixtureArr[index];
        let teamsArr = await fixture.$$('span.qa-full-team-name');
        let scoreArr = await fixture.$$('span.sp-c-fixture__number--ft');
        let liveScoreArr = await fixture.$$('span.sp-c-fixture__number--live-sport');

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
    console.log("loading data...");
    fetchFixArr(getMatchDates()).then((resp) => {
        Promise.all(resp.data).then(fixArr => {
            console.log("brings afix arr", fixArr)
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

router.post("/updatebet", (req, res) => {
    const { userID, teams, score } = req.body;

    UserModel.findOne(
        { userID: userID },
        (err, data) => {
            if (err) res.json({ success: false, err: err });

            let { betData } = data;
            let updatedBet = updateBet(teams, score, betData.currentBet);

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

let settleWeekArr = [];

function settleScore() {
    console.log("it starts the cycle")
    let currentDate = new Date();
    let dates = getMatchDates();

    if (currentDate.getUTCDay() !== 0 && currentDate.getUTCDay() !== 6) return;


    fetchFixArr(dates).then((resp) => {
        Promise.all(resp.data).then(fixArr => {
            let flatFix = [];
            for (let fix of fixArr) {
                if (fix.success === true) {
                    flatFix = flatFix.concat(fix.data);
                }
            }
            if (flatFix.length === 0) {
                settleWeekArr.push(dates[0]);
                return;
            }

            UserModel.find({}).then(data => {
                for (let user of data) {
                    //console.log(user);
                    let linkArr = fixInBet(flatFix, user.betData.currentBet);
                    if (linkArr.length !== 0) {
                        let { betData } = user;
                        let length = betData.betHistory.length;
                        let historyArr = (betData.betHistory[length-1].week===dates[0])? betData.betHistory[length-1].historyArr : [];
                        let l = historyArr.length;
                        let totalPt = 0;
                        let removeList = [];
                        for (let link of linkArr) {
                            if (flatFix[link[0]].score !== null) {
                                let history = new HistoryModel();
                                history.teams = user.betData.currentBet[link[1]].teams;
                                history.betScore = user.betData.currentBet[link[1]].betScore;
                                history.gameDate = flatFix[link[0]].date;
                                history.actualScore = flatFix[link[0]].score;

                                if (history.betScore[0] === parseInt(history.actualScore[0]) && history.betScore[0] === parseInt(history.actualScore[0])) {
                                    history.points = 5;
                                    totalPt += 5;
                                }
                                else if ((history.betScore[0] === history.betScore[1] && history.actualScore[0] === history.actualScore[1]) || (history.betScore[0] > history.betScore[1] && history.actualScore[0] > history.actualScore[1]) || (history.betScore[0] < history.betScore[1] && history.actualScore[0] < history.actualScore[1])) {
                                    history.points = 2;
                                    totalPt += 2;
                                }

                                historyArr.push(history);
                                removeList.push(link[1]);
                            }
                        }

                        if (historyArr.length > l) {
                            if(l===0) {
                                betData.betHistory.push({
                                    week: dates[0],
                                    totalPt: totalPt,
                                    historyArr: historyArr
                                })
                            }
                            else if(l>0) {
                                betData.betHistory[length-1] = {
                                    ...betData.betHistory[length-1],
                                    totalPt: betData.betHistory[length-1].totalPt+totalPt,
                                    historyArr: historyArr
                                }
                            }
                            

                            let newCurrentBet = [];
                            // betData.currentBet.forEach((bet, i) => {
                            //     if (removeList.indexOf(i) === -1) newCurrentBet.push(bet);
                            // })

                            betData.currentBet = newCurrentBet;

                            UserModel.findOneAndUpdate(
                                { userID: user.userID },
                                { $set: { betData: betData } },
                                { new: true },
                                (err, data) => {
                                    if (err) {
                                        console.log(err);
                                        return err;
                                    }

                                    let emailString = `Bet result for week of ${dates[0]}\n\nYou won ${totalPt} total points this week.\n\n`;

                                    for (let history of historyArr) {
                                        let detailText = `Teams: ${history.teams[0]} vs ${history.teams[1]}\n
                                        Your Bet: ${history.betScore[0]}, ${history.betScore[1]}\n
                                        Final Score: ${history.actualScore[0]}, ${history.actualScore[1]}\n
                                        Points won: ${history.points}\n\n`;

                                        emailString += detailText;
                                    }
                                    mailOptions.to = data.email;
                                    mailOptions.subject = `Week of ${dates[0]} bet soccer result!`;
                                    mailOptions.text = emailString;
                                    sendEmail();
                                    console.log(JSON.stringify(data, null, " "));
                                }
                            )
                        }

                    }
                }
            })

            settleWeekArr.push(dates[0]);
            return;

        })
    })

    return;
}

//settleScore();
let settleTask = setTimeout(settleScore, 3600000);

function fixInBet(fixArr, betArr) {
    let linkArr = [];

    fixArr.forEach((match, i) => {
        betArr.forEach((bet, j) => {
            if (match.teamName[0] === bet.teams[0] && match.teamName[1] === bet.teams[1]) linkArr.push([i, j]);
        })
    })

    return linkArr;
}

function updateBet(teams, score, betArr) {
    for (let i = 0; i < betArr.length; i++) {
        if (betArr[i].teams[0] === teams[0] && betArr[i].teams[1] === teams[1]) {
            betArr[i].betScore = score;
            return betArr;
        }
    }

    return false;
}

function removeTeams(teams, betArr) {
    for (let i = 0; i < betArr.length; i++) {
        if ((betArr[i].teams[0] === teams[0] && betArr[i].teams[1] === teams[1]) || (betArr[i].teams[0] === teams[1] && betArr[i].teams[1] === teams[0])) {
            betArr.splice(i, 1);
            return betArr;
        }
    }

    return false;
}

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

//mailOptions.to = "dgebreselasse@gmail.com";
//sendEmail();



// launch our backend into a port
app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));