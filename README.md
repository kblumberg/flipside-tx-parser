# Flipside Tx Parser
## Getting Started
First input your snowflake credentials at `USERNAME_HERE` and `PASSWORD_HERE`.

Then, first run `npm i` to install the libraries then `npx tsc` to compile then `node build/index.js` to run the script.

Once it's saved to the `/output` folder, you can open the json file and press `Option + Shift + F` to auto-format the json nice and clean.

The script currently pulls 1 transaction from each program ID and runs the parser, then saving the output.

## Parameters
If we want, we can change it to run for all transactions or any subset that we want.

Right now I've pulled 5 IDLs from the top program IDs that are on SolScan. I haven't really delved super deep, but maybe there are more we can find.

## Limitations
It seems like most programs do not have their IDLs public. Checking on SolScan, most are missing, even from the top programs.

## Next Steps
Change the code to pull the information for whatever transactions we want, then pipe that data to a location where we want it. Will probably also want to add some error handling.

We can also probably put snowflake credentials into a `.env` file.