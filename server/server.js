const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const app = express();
const port = 8080;

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.get("/run-script", (req, res) => {
    const userInput = req.query.user_input;

    if (!userInput) {
        return res.status(400).send("No user_input parameter provided.");
    }

    const scriptPath = "./script.sh";

    exec(`bash ${scriptPath} ${userInput}`, (error, stdout, stderr) => {
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
