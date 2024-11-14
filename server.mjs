import express from "express";
import fetch from "node-fetch";

const port = 8080;
const app = express();

//app.use(express.static("public"));
app.use(express.static(`${import.meta.dirname}`));

app.get("/", (req, res) => {
    res.sendFile(`${import.meta.dirname}/index.html`);
});

app.get("/nickname", async (req, res) => {
    let nickname = '';
    try {
        const response = await fetch('https://namegen.com/more/usernames/');
        const json = await response.json();
        nickname = json.result[0];
    } catch (e) {
        console.error('Unable to get nickname', e);
    } finally {
        res.json({ result: [nickname] });
    }
});

app.listen(port, () => { console.log(`Server running on port ${port}`); });