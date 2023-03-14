import * as snowflake from 'snowflake-sdk';
import { Idl } from '@project-serum/anchor';
import { PublicKey, Message, Connection, ConnectionConfig, GetVersionedTransactionConfig } from '@solana/web3.js';
import { writeFile, readdirSync, readFileSync } from 'fs';
import { compiledInstructionToInstruction, parseTransactionAccounts, SolanaParser } from '@debridge-finance/solana-transaction-parser';


export const NETWORK = 'https://red-cool-wildflower.solana-mainnet.quiknode.pro/a1674d4ab875dd3f89b34863a86c0f1931f57090/';

export const CONFIG: ConnectionConfig = {
	commitment: 'confirmed',
	disableRetryOnRateLimit: false,
	confirmTransactionInitialTimeout: 150000
};

const snowConnect = snowflake.createConnection({
    account: 'vna27887.us-east-1',
    username: 'USERNAME_HERE', // TODO
    password: 'PASSWORD_HERE', // TODO
    authenticator: 'SNOWFLAKE', 
    warehouse: 'DATA_SCIENCE',
    role: 'INTERNAL_DEV',
    clientSessionKeepAlive: true,
})
snowflake.configure({ ocspFailOpen: false })

// for all the Program IDLs in the ./src/idl/ directory, parse 1 tx for each program id
const parsePrograms = async () => {
    // read all the idl json files (exclude candy machine - gets weird errors)
    const files = readdirSync('./src/idl').filter(x => x.includes('.json') && !x.includes('cndy'));

    // connect to snowflake
    snowConnect.connect(async function (err, conn) {
        if (err) {
            console.error("Unable to connect: " + err.message)
        } else {
            // iterate over program ids
            for (let i = 0; i < files.length; i++) {
                const programId = files[i].split('.')[0]
                console.log(`Starting programId ${programId}`);                

                // query a single tx with that program id
                conn.execute({
                    sqlText: `
                        SELECT tx_id
                        , TO_VARCHAR(block_timestamp::date) AS date
                        FROM solana.core.fact_events
                        WHERE program_id = '${programId}'
                            AND succeeded
                        LIMIT 1`,
                        // AND tx_id = '5zgvxQjV6BisU8SfahqasBZGfXy5HJ3YxYseMBG7VbR4iypDdtdymvE1jmEMG7G39bdVBaHhLYUHUejSTtuZEpEj'
                    complete: async function (err, stmt) {
                        if (err) {
                            console.error("Failed to execute statement due to the following error: " + err.message)
                        } else {
                            var stream = stmt.streamRows();
                            stream.on('data', async function (row)
                            {
                                // parse the tx and save it to the output file
                                const tx_id: string = row['TX_ID'];
                                const date: string = row['DATE'];
                                await parseTx(tx_id, date, programId, conn);
                            });
                        }
                    }
                })
            }
        }
    })
}

// parser tx instructions and save to file
const parseTx = async (txId: string, date: string, programId:string, conn: snowflake.Connection) => {

    conn.execute({
        sqlText: `
        SELECT *
        FROM solana.core.fact_transactions
        WHERE block_timestamp::date = '${date}'
            AND tx_id = '${txId}'`,
        complete: async function (err, stmt) {
            if (err) {
                console.error("Failed to execute statement due to the following error: " + err.message)
            } else {
                            
                var stream = stmt.streamRows();
                stream.on('data', function (row)
                {
                    // parse the query results
                    const accountKeysResult: string[] = row['ACCOUNT_KEYS'].map((x: any) => x.pubkey);
                    const accountKeys = accountKeysResult.map(x => new PublicKey(x));

                    // we can only parse instructions using program ids of the IDLs we have
                    const instructionsResult: any[] = row['INSTRUCTIONS'].filter((x: any) => x.programId == programId);
                    
                    // compile the tx instructions
                    const instructions = instructionsResult.map(x => {
                        const accounts: string[] = x['accounts'];
                        const programIdIndex = accountKeysResult.indexOf(x['programId']);
                        
                        return({
                            'accounts': accounts.map(x => new PublicKey(x))
                            , 'data': x['data']
                            , 'programId': x['programId']
                            , 'programIdIndex': programIdIndex
                        });
                    });
                    
                    const messageArgs = {
                        // the header i think can be anything with these fields
                        'header': {
                            numRequiredSignatures: 1
                            // The last `numReadonlySignedAccounts` of the signed keys are read-only accounts
                            , numReadonlySignedAccounts: 0
                            // The last `numReadonlySignedAccounts` of the unsigned keys are read-only accounts
                            , numReadonlyUnsignedAccounts: 9
                        }
                        , 'accountKeys': accountKeys
                        , 'recentBlockhash': 'DDeetiKt5VwFMUEqLp1Y65fbGTDqc42iAJZPttDPM4g'
                        , 'instructions': instructions as any
                    }
                    const message = new Message(messageArgs)

                    const parsedAccounts = parseTransactionAccounts(message, { readonly: [], writable: [] });

                    // load the IDL from file
                    const idlText = readFileSync(`./src/idl/${programId}.json`, 'utf8');
                    var idl = JSON.parse(idlText) as Idl;
                    // @ts-ignore
                    const txParser = new SolanaParser([{ idl: idl, programId: programId }]);

                    // parse the tx
                    const inst = message.compiledInstructions.map((instruction) => txParser.parseInstruction(compiledInstructionToInstruction(instruction, parsedAccounts)));
                    const inst2 = inst.map((x, i) => {
                        // clean up the fields a bit
                        const ret = x.accounts.map((y, j) => {
                            y['pubkey'] = instructions[i].accounts[j];
                            return(y)
                        })
                        x['accounts'] = ret
                        const xArgs = x.args as any;
                        for (const property in xArgs) {
                            if (typeof xArgs[`${property}`] === 'object' || typeof xArgs[`${property}`] === 'string' || xArgs[`${property}`] instanceof String) {
                                xArgs[`${property}`] = parseInt(xArgs[`${property}`])
                            }
                        }
                        x['args'] = xArgs;
                        return(x);
                    })

                    // convert to json and write to file
                    const json = JSON.stringify(inst2);
                    const callbackFn = (msg: any) => {
                        if (msg) {
                            console.log('Error writing to file:');
                            console.log(msg);
                        }
                    }
                    writeFile(`./output/${programId}_${txId}.json`, json, callbackFn);
                    console.log(`Finished with tx ${txId}`);                    
                });
            }
        }
    })
}


// function readTextFile(file: any, callback: any) {
//     console.log('readTextFile');
//     var rawFile = new XMLHttpRequest();
//     rawFile.overrideMimeType("application/json");
//     console.log('readTextFile 32');
//     rawFile.open("GET", file, true);
//     console.log('readTextFile 34');
//     rawFile.onreadystatechange = function() {
//         console.log('readTextFile 36');
//         // if (rawFile.readyState === 4 && rawFile.status == "200") {
//         if (rawFile.readyState === 4) {
//             callback(rawFile.responseText);
//         }
//     }
//     console.log('readTextFile 42');
//     rawFile.send(null);
//     console.log('readTextFile 44');
// }

const getTxSizes = async () => {

    // readTextFile("./src/tx_sizes.json", function(text: any){
    //     console.log('readTextFile callback');
    //     console.log(text);
    //     var data = JSON.parse(text);
    //     console.log('readTextFile data');
    //     console.log(data);
    // });
    const text = readFileSync(`./src/tx_sizes.json`, 'utf8');
    const j = JSON.parse( text );
    const results = [];
    let nCorrect = 0;
    let nIncorrect = 0;

    const config: GetVersionedTransactionConfig = {
        'commitment': 'confirmed'
        , 'maxSupportedTransactionVersion': 100
    }

    // for (let i = 0; i < j.length; i++) {
    for (let i = 0; i < 300; i++) {
        if (i % 10 == 0) {
            console.log(i)
        }
        const el: any = j[i];
        // console.log(`${i} el`)
        // console.log(el)

        const txId = el['TX_ID'];
        const connection = new Connection(NETWORK, CONFIG);
        const result = await connection.getTransaction(txId, config);
        // const tx = new Transaction(result);
        // console.log('result');
        // console.log(result);
        if (result) {
            // console.log('serialized0');
            const serialized = result.transaction.message.serialize()
            // console.log('serialized');
            // console.log(serialized);
            const size = (serialized ? serialized.length : 0) + 1 + result.transaction.signatures.length * 64;
            el['size'] = size;
            results.push(el);
            // console.log('size');
            // console.log(size);
            // const isCorrect = (size == sizes[i]) ? 1 : 0
            // nCorrect += isCorrect;
            // nIncorrect += (1 - isCorrect);
            // if (!isCorrect) {
            //     if (size - 1 == sizes[i]) {
            //         // console.log(`1 too small`)
            //     } else {
            //         console.log(`${txId}: db=${sizes[i]}; actual = ${size} `);
            //         console.log(result);
            //     }
            // }
        }
    }
    // console.log('97');
    const json = JSON.stringify(results);
    // console.log('json');
    // console.log(json);
    writeFile('myjsonfile.json', json, 'utf8', (tmp: any) => {console.log(tmp)});
}

getTxSizes();