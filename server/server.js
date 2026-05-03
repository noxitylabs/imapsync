const express = require("express");
const cors = require("cors");
const path = require("path");
const { execFile } = require("child_process");
const app = express();
const port = 8080;

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;
const SCRIPT_PATH = path.join(__dirname, "script.sh");

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.get("/run-script", (req, res) => {
    const userInput = req.query.user_input;

    if (!userInput) {
        return res.status(400).send("No user_input parameter provided.");
    }

    if (typeof userInput !== "string" || !DOMAIN_RE.test(userInput)) {
        return res.status(400).send("Invalid domain.");
    }

    execFile("bash", [SCRIPT_PATH, userInput], { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing script: ${error}`);
            return res
                .status(500)
                .send(`Error executing script: ${error.message}`);
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return res.status(500).send(`stderr: ${stderr}`);
        }

        res.send(`${stdout}`);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
