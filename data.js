const mongoose = require('mongoose');
const Schema = mongoose.Schema;

//database document structure
const UserSchema = new Schema(
    {
        userID: { type: String, default: "" },
        email: { type: String, default: "" },
        name: { type: String, default: "" },
        betData: { type: Object, default: { currentBet: [], betHistory: [] } }
    },
    { timestamps: true, _id: true, minimize: false, strict: false }
);

const BetSchema = new Schema(
    {
        teams: { type: Object, default: [] },
        ranking: { type: Object, default: [] },
        betScore: { type: Object, default: [] },
        gameDate: { type: Date, default: null },
        actualScore: { type: Object, default: [] },
    },
    { timestamps: true, _id: true, minimize: false, strict: false }
);

const historySchema = new Schema (
    {
        teams: { type: Object, default: [] },
        betScore: { type: Object, default: [] },
        gameDate: { type: Date, default: null },
        actualScore: { type: Object, default: [] },
    },
    { timestamps: true, _id: true, minimize: false, strict: false }
)


// create the Schema models
const UserModel = mongoose.model("User", UserSchema);
const BetModel = mongoose.model("Bet", BetSchema);
const HistoryModel = mongoose.model("History", historySchema);

//export the new Schemas so we could modify them using Node.js
module.exports = { UserModel, BetModel, HistoryModel };