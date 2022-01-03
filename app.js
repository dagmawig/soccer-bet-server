const pup = require('puppeteer');

const config = {
    headless: true,
    devtools: false
}

const doScrap = async () => {
    const browser = await pup.launch(config);
    const page = await browser.newPage();

    await page.goto('https://www.bbc.com/sport/football/scores-fixtures/2022-01-02', { waitUntil: 'networkidle0' });

    //let data = [];
    let elementArr = await page.$$('div.qa-match-block');
    // for (var ele of elementArr) {
    //     let h3Text = await ele.$eval('h3', (res) => {
    //         return res.innerHTML;
    //     })
    //     data.push(h3Text);
    // }
    let leagueElement;

    for(var ele of elementArr) {
        let h3Text = await ele.$eval('h3', (res) => {
            return res.innerHTML;
        })
        if(h3Text==='Premier League') {
            leagueElement = ele;
            break;
        }
    }
  

    let fixtureArr = await leagueElement.$$('div.sp-c-fixture__wrapper');

    let data = [];

    for(let fixture of fixtureArr) {
        let teamsArr = await fixture.$$('abbr');
        let scoreArr = await fixture.$$('span.sp-c-fixture__number--ft')
        let arr = [];
        for(let team of teamsArr) {
            let teamHTML = await team.getProperty('innerHTML');
            let teamText = await teamHTML.jsonValue();
            arr.push(teamText);
        }
        for (let score of scoreArr) {
            let scoreHTML = await score.getProperty('innerHTML');
            let scoreText = await scoreHTML.jsonValue();
            arr.push(scoreText)
        }
        data.push(arr)
    }
    return data;
    //let element = await page.$('div.qa-match-block');
    //let value = await page.evaluate(el => el.textContent, element)
    //return element;
}

doScrap().then((res) => {
    console.log(res);
})
