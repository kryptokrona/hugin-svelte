const windowStateManager = require('electron-window-state');
const contextMenu = require('electron-context-menu');
const {app, BrowserWindow, ipcMain, ipcRenderer} = require('electron');
const serve = require('electron-serve');
const path = require('path');
const {join} = require('path')
const {JSONFile, Low} = require("@commonify/lowdb");
const fs = require('fs')
const WB = require("kryptokrona-wallet-backend-js");
const {default: fetch} = require("electron-fetch");
const nacl = require('tweetnacl')
const naclUtil = require('tweetnacl-util')
const naclSealed = require('tweetnacl-sealed-box')
const {extraDataToMessage} = require('hugin-crypto')
const sanitizeHtml = require('sanitize-html')

const en = require ('int-encoder');

const { Address,
    AddressPrefix,
    Block,
    BlockTemplate,
    Crypto,
    CryptoNote,
    LevinPacket,
    Transaction} = require('kryptokrona-utils')


const xkrUtils = new CryptoNote()
const hexToUint = hexString => new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

function getXKRKeypair() {
    const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
    return {privateSpendKey: privateSpendKey, privateViewKey: privateViewKey};
}

function getKeyPair() {
    // return new Promise((resolve) => setTimeout(resolve, ms));
    const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
    let secretKey = naclUtil.decodeUTF8(privateSpendKey.substring(1, 33));
    let keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    return keyPair;
}

function getMsgKey() {

    const naclPubKey = getKeyPair().publicKey
    return  Buffer.from(naclPubKey).toString('hex');
}

function toHex(str,hex){
    try{
        hex = unescape(encodeURIComponent(str))
            .split('').map(function(v){
                return v.charCodeAt(0).toString(16)
            }).join('')
    }
    catch(e){
        hex = str
        //console.log('invalid text input: ' + str)
    }
    return hex
}



function nonceFromTimestamp(tmstmp) {

    let nonce = hexToUint(String(tmstmp));

    while ( nonce.length < nacl.box.nonceLength ) {

        let tmp_nonce = Array.from(nonce);

        tmp_nonce.push(0);

        nonce = Uint8Array.from(tmp_nonce);

    }

    return nonce;
}


function fromHex(hex, str) {
    try {
        str = decodeURIComponent(hex.replace(/(..)/g, '%$1'))
    } catch (e) {
        str = hex
        // console.log('invalid hex input: ' + hex)
    }
    return str
}


function trimExtra(extra) {

    try {
        let payload = fromHex(extra.substring(66));

        let payload_json = JSON.parse(payload);
        return fromHex(extra.substring(66))
    } catch (e) {
        return fromHex(Buffer.from(extra.substring(78)).toString())
    }
}

try {
    require('electron-reloader')(module);
} catch (e) {
    console.error(e);
}

const serveURL = serve({directory: "."});
const port = process.env.PORT || 3000;
const dev = !app.isPackaged;
let mainWindow;

function createWindow() {
    let windowState = windowStateManager({
        defaultWidth: 1100,
        defaultHeight: 700,
    });

    const mainWindow = new BrowserWindow({
        backgroundColor: '#202020',
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        trafficLightPosition: {
            x: 17,
            y: 12,
        },
        minHeight: 600,
        minWidth: 800,
        webPreferences: {
            enableRemoteModule: true,
            contextIsolation: true,
            nodeIntegration: true,
            spellcheck: false,
            devTools: dev,
            preload: path.join(__dirname, "preload.cjs")
        },
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
    });

    windowState.manage(mainWindow);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.openDevTools()
    });

    mainWindow.on('close', () => {
        windowState.saveState(mainWindow);
    });

    return mainWindow;
}

contextMenu({
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    showCopyImage: false,
    prepend: (defaultActions, params, browserWindow) => [
        {
            label: 'Make App 💻',
        },
    ],
});

function loadVite(port) {
    mainWindow.loadURL(`http://localhost:${port}`).catch((e) => {
        console.log('Error loading URL, retrying', e);
        setTimeout(() => {
            loadVite(port);
        }, 200);
    });
}

function createMainWindow() {
    mainWindow = createWindow();
    mainWindow.once('close', () => {
        mainWindow = null
    });

    if (dev) loadVite(port);
    else serveURL(mainWindow);
}


app.on('ready', createMainWindow)
app.on('activate', () => {
    if (!mainWindow) {
        createMainWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let userDataDir = app.getPath('userData');

let node = 'blocksum.org'
let ports = 11898
const daemon = new WB.Daemon(node, ports);

//Create misc.db
const file = join(userDataDir, 'misc.db')
const adapter = new JSONFile(file)
const db = new Low(adapter)

//Create boards.db
const fileBoards = join(userDataDir, 'boards.db')
const adapterBoards = new JSONFile(fileBoards)
const dbBoards = new Low(adapterBoards)

//Create messages.db
const fileMessages = join(userDataDir, 'messages.db')
const adapterMessages= new JSONFile(fileMessages)
const dbMessages = new Low(adapterMessages)

//Create keychain.db
const fileKeys = join(userDataDir, 'keychain.db')
const adapterChain = new JSONFile(fileKeys)
const keychain = new Low(adapterChain)

//Create knownTxs.db
const fileTxs = join(userDataDir, 'knowntxs.db')
const adapterTxs = new JSONFile(fileTxs)
const knownTxs = new Low(adapterTxs)



let js_wallet;
let c = false;
let walletName

startCheck()
let known_keys = [];

async function startCheck() {


if (fs.existsSync(userDataDir + '/messages.db')) {
    // We have found a wallet file
    await db.read()
    let walletName = db.data.walletNames
    console.log('walletname', walletName);
    ipcMain.on('app', (data) => {
        mainWindow.webContents.send('getPath', userDataDir)
        return mainWindow.webContents.send('wallet-exist', true, walletName);
    })


    ipcMain.on('login', async (event, data) => {
      let walletName = data.thisWallet
      let password = data.myPassword
      console.log('creating this wallet', walletName);
      console.log('password', password);
      start_js_wallet(walletName, password);
      console.log(c)
    })

} else {
  //No wallet found, probably first start
  console.log('wallet not found')

  //Create DBs on first start
  db.data = {walletNames:[],
            blockHeight:[],}
  dbBoards.data = {messages: []}
  dbMessages.data = {messages: [ {
      "from": "Hugin Messenger",
      "k": "munin",
      "msg": "Welcome to Hugin Messenger",
      "t": 1650919475320,
      "type": "box",
      "sent": false
    },]}
  keychain.data = {known_keys:[]}
  knownTxs.data = {known_txs:[]}
  //
  await keychain.write(keychain.data)
  await knownTxs.write(knownTxs.data)
  await dbBoards.write(dbBoards.data)
  await dbMessages.write(dbMessages.data)
  await db.write(db.data)
  console.log('creating dbs...');
  return mainWindow.webContents.send('wallet-exist', false, walletName)
}
}

let myPassword;

ipcMain.on('create-account', async (e, accountData) => {
    let walletName = accountData.walletName
    let myPassword = accountData.password
    console.log('creating', walletName);
    const newWallet = await WB.WalletBackend.createWallet(daemon);
    newWallet.saveWalletToFile(userDataDir + '/' + walletName + '.wallet', myPassword)
    js_wallet = newWallet
    console.log(myPassword)
    db.data.walletNames.push(walletName)
    await db.write()
    await start_js_wallet(walletName, myPassword);
  })

async function loadKeys() {

//Load known public keys from db and push them to known_keys
await keychain.read()
known_keys = keychain.data.known_keys
console.log('known keys', known_keys);

}

async function loadKnownTxs() {

//Load known txs from db and then load them in to known_pool_txs
await knownTxs.read()
const known_pool_txs = knownTxs.data.known_txs
console.log('KNOWN POOOL TXS', known_pool_txs);
return known_pool_txs
}

let syncing = true;

async function start_js_wallet(walletName, password) {
    /* Initialise our blockchain cache api. Can use a public node or local node
       with `const daemon = new WB.Daemon('127.0.0.1', 11898);` */
       //Load known public keys
      await loadKeys();

       //Load known pool txs from db.
      let knownTxs = await loadKnownTxs()
    //
    // if (c === 'c') {
    //
    //   let height = 1033909
    //
    //     try {
    //         let re = await fetch('http://' + node + ':' + ports + '/getinfo');
    //
    //         height = await re.json();
    //
    //     } catch (err) {
    //
    //     }
    //
    // } else if (c === 'o') {
        /* Open wallet, giving our wallet path and password */

        try {

          const [openedWallet, error] = await WB.WalletBackend.openWalletFromFile(daemon, userDataDir + '/' + walletName + '.wallet', password);
          if (error) {
              console.log('Failed to open wallet: ' + error.toString());
              return;
              }

              js_wallet = openedWallet;

        } catch(err) {
          console.log('Error', err);
        }


    js_wallet.enableAutoOptimization(false);

    /* Enable debug logging to the console */


    /* Start wallet sync process */
    await js_wallet.start();

    js_wallet.on('incomingtx', (transaction) => {

        console.log(`Incoming transaction of ${transaction.totalAmount()} received!`);

        // if (!syncing) {
        mainWindow.webContents.send('new-message', transaction.toJSON());
        // }

    });

    let i = 1;

    for (const address of js_wallet.getAddresses()) {
        console.log(`Address [${i}]: ${address}`);
        let msgKey = getMsgKey()
        console.log('HuginAddress',address + msgKey)
        i++;
    }

    i = 1;

    let boards_addresses = [];

    for (const address of js_wallet.getAddresses()) {
        const [publicSpendKey, privateSpendKey, err] = await js_wallet.getSpendKeys(address);
        boards_addresses[boards_addresses.length] = [address, publicSpendKey];
        console.log(`Address [${i}]: ${address}`);
        i++;
    }

    console.log('Started wallet');
    //Load knownTxsIds to backgroundSyncMessages on startup
    await backgroundSyncMessages(knownTxs)
    while (true) {
      try {
        //Start syncing
        await backgroundSyncMessages()
        await sleep(1000 * 3);
        const [walletBlockCount, localDaemonBlockCount, networkBlockCount] =
            await js_wallet.getSyncStatus();
        if ((localDaemonBlockCount - walletBlockCount) < 2) {
            // Diff between wallet height and node height is 1 or 0, we are synced
            mainWindow.webContents.send('sync', 'synced');
            console.log('walletBlockCount', walletBlockCount);
            console.log('localDaemonBlockCount', localDaemonBlockCount);
            console.log('networkBlockCount', networkBlockCount);
            syncing = false;
        } else {
        console.log('Syncing wallet ', walletBlockCount);
        console.log('Syncing local d', localDaemonBlockCount);
        console.log('Syncing network', networkBlockCount);
            if ((localDaemonBlockCount - walletBlockCount) > 1000) {
                console.log('rewinding forward');
                js_wallet.rewind(networkBlockCount - 500);
                await sleep(3000 * 10);
            }
        }
        //Save height to misc.db
        db.data.blockHeight = {walletBlockCount, localDaemonBlockCount, networkBlockCount}
        await db.write(db.data)
        console.log( await js_wallet.getBalance())
        console.log('');

      } catch (err) {
      console.log(err);
      }
    }
}

let known_pooL_txs = []

async function backgroundSyncMessages(knownTxsIds) {

    if (knownTxsIds) {
    console.log('First start, push knownTxs db to known pool txs');
    known_pool_txs = knownTxsIds
    }

    console.log('Background syncing...');
    let message_was_unknown;
    try {
        const resp = await fetch('http://' + 'pool.kryptokrona.se:11898' + '/get_pool_changes_lite', {
            method: 'POST',
            body: JSON.stringify({knownTxsIds: known_pool_txs})
        })

        let json = await resp.json();

        json = JSON.stringify(json).replaceAll('.txPrefix', '').replaceAll('transactionPrefixInfo.txHash', 'transactionPrefixInfotxHash');

        json = JSON.parse(json);

        let transactions = json.addedTxs;
        let transaction;

        //Try clearing known pool txs from checked
        console.log('known pool tx', known_pooL_txs);
        known_pooL_txs = known_pooL_txs.filter(n => !json.deletedTxsIds.includes(n))
        console.log('cleared txs', known_pooL_txs);
        console.log('txs?', transactions);
        if (transactions.length === 0) {
            console.log('Empty array...')
            return;
        }

        for (transaction in transactions) {

            try {
                console.log('tx', transactions[transaction]);
                let thisExtra = transactions[transaction].transactionPrefixInfo.extra;
                let thisHash = transactions[transaction].transactionPrefixInfotxHash;

                if (known_pool_txs.indexOf(thisHash) === -1) {
                    known_pool_txs.push(thisHash);
                    message_was_unknown = true;

                } else {
                    message_was_unknown = false;
                    console.log("This transaction is already known", thisHash);
                    continue;
                }

                  let message
                  if (thisExtra !== undefined && thisExtra.length > 200) {
                      message = await extraDataToMessage(thisExtra, known_keys, getXKRKeypair());
                      if (!message) {
                        console.log('Caught undefined null message, continue');
                        continue;
                      }
                      let clean = sanitizeHtml(message);
                      console.log('message', message.msg);
                      clean.sent = false

                      console.log('Clean', clean);

                      mainWindow.webContents.send('clean', clean)
                      //Checking if private msg is a call
                      if (message.type == "sealedbox" || "box") {
                      console.log('Checking if private msg is a call');
                      parseCall(message.msg, message.from)

                      }

                      console.log('Message?', message.msg)

                      saveMsg(message);
                  }

                  console.log('Transaction checked');
                  //saveHash(thisHash)

                } catch (err) {
                  console.log(err)
                }

            }

        } catch (err) {
        console.log(err);
        console.log('Sync error')
        }
}

async function saveKey(key) {

  known_keys.push(key)
  console.log('Pushing this to known keys ', known_keys)
  keychain.data.known_keys.push(key)
  await keychain.write()

}

async function saveHash(hash) {

    //Saving checked txHash to db to avoid doublesyncing messages from mempool *** Munin
    //console.log('Saving checked txHash to db');
    //knownTxs.data.known_txs.push(thisHash)
    //await knownTxs.write()

}

async function saveMsg(message, hash) {


  //Save messages and known tx hashes
   dbBoards.data = dbBoards.data
   dbMessages.data = dbMessages.data

  switch (message.type) {
      case "sealedbox":
      let senderKey = message.k
      console.log('saving this senderkey', senderKey)
      saveKey(senderKey)
          dbMessages.data.messages.push(message)
          await dbMessages.write()
          mainWindow.webContents.send('newMsg', dbMessages.data)
          break;
      case "box":
          dbMessages.data.messages.push(message)
          await dbMessages.write()
          mainWindow.webContents.send('newMsg', dbMessages.data)
          break;
      default:
          if (message) {
              dbBoards.data.messages.push(message)
              await dbBoards.write()
          }
          break;
  }

}

//SWITCH NODE
ipcMain.on('switchNode', async (e, node) => {
    console.log(`Switching node to ${node}`)
    const daemon = new WB.Daemon(node.split(':')[0], parseInt(node.split(':')[1]));
    await js_wallet.swapNode(daemon);
    db.write()
});


ipcMain.on('sendMsg', (e, msg, receiver) => {
        sendMessage(msg, receiver);
        console.log(msg, receiver)
    }
)

ipcMain.on('answerCall', (e, msg, contact) => {
    mainWindow.webContents.send('answer-call', msg, contact)
    }
)

async function sendMessage(message, receiver) {
    console.log('Want to send')
    let has_history = false
    let address = receiver.substring(0,99);
    let messageKey =  receiver.substring(99,163);
        //receiver.substring(99,163);
    if (known_keys.indexOf(messageKey) > 0) {

      console.log('I know this contact?');
      has_history = true;

    } else {

      has_history = false
      saveKey(messageKey);

    }
//receiver.substring(99,163);
    if (message.length == 0) {
        return;
    }


    let my_address = await js_wallet.getPrimaryAddress();

    let my_addresses = await js_wallet.getAddresses();

    try {

        let [munlockedBalance, mlockedBalance] = await js_wallet.getBalance();
        //console.log('bal', munlockedBalance, mlockedBalance);

        if (munlockedBalance < 11 && mlockedBalance > 0) {

            log
            return;

        }
    } catch (err) {
        return;
    }

    let timestamp = Date.now();


    // **TO DO** Check whether this is the first outgoing transaction to the recipient
    // CHECK IN SVELT FROM ACTIVE CONTACT???


    // History has been asserted, continue sending message

    let box;

    if (!has_history) {
        //console.log('No history found..');
        // payload_box = {"box":Buffer.from(box).toString('hex'), "t":timestamp};
        const addr = await Address.fromAddress(my_address);
        const [privateSpendKey, privateViewKey] = js_wallet.getPrimaryAddressPrivateKeys();
        let xkr_private_key = privateSpendKey;
        let signature = await xkrUtils.signMessage(message, xkr_private_key);
        let payload_json = {
            "from": my_address,
            "k": Buffer.from(getKeyPair().publicKey).toString('hex'),
            "msg": message,
            "s": signature
        };
        let payload_json_decoded = naclUtil.decodeUTF8(JSON.stringify(payload_json));
        box = new naclSealed.sealedbox(payload_json_decoded, nonceFromTimestamp(timestamp), hexToUint(messageKey));
    } else {
        //console.log('Has history, not using sealedbox');
        // Convert message data to json
        let payload_json = {"from": my_address, "msg": message};

        let payload_json_decoded = naclUtil.decodeUTF8(JSON.stringify(payload_json));


        box = nacl.box(payload_json_decoded, nonceFromTimestamp(timestamp), hexToUint(messageKey), getKeyPair().secretKey);

    }

    let payload_box = {"box": Buffer.from(box).toString('hex'), "t": timestamp};

    // let payload_box = {"box":Buffer.from(box).toString('hex'), "t":timestamp, "key":Buffer.from(getKeyPair().publicKey).toString('hex')};
    // Convert json to hex
    let payload_hex = toHex(JSON.stringify(payload_box));

    let result = await js_wallet.sendTransactionAdvanced(
        [[address, 1]], // destinations,
        3, // mixin
        {fixedFee: 7500, isFixedFee: true}, // fee
        undefined, //paymentID
        undefined, // subWalletsToTakeFrom
        undefined, // changeAddress
        true, // relayToNetwork
        false, // sneedAll
        Buffer.from(payload_hex, 'hex')
    );

    if (result.success) {
        console.log(`Sent transaction, hash ${result.transactionHash}, fee ${WB.prettyPrintAmount(result.fee)}`);
        const sentMsg = {msg: message, k: messageKey, from: address, sent: true, t: timestamp}
        dbMessages.data.messages.push(sentMsg)
        await dbMessages.write()
        mainWindow.webContents.send('newMsg', dbMessages.data)
        known_pool_txs.push(result.transactionHash)
    } else {
        console.log(`Failed to send transaction: ${result.error.toString()}`);
    }
}

ipcMain.handle('getMessages', async () => {
    await dbMessages.read()
    return dbMessages.data
})

ipcMain.handle('getBalance', async () => {
    return await js_wallet.getBalance()
})

ipcMain.handle('getAddress',  async () => {
    return js_wallet.getAddresses()

})



ipcMain.on('startCall', async (e ,contact, calltype) => {
    console.log('CALL STARTEeeeeeeeeeeeeD')

    console.log('contact', contact + calltype);
    mainWindow.webContents.send('start-call', contact, calltype)

})



ipcMain.on('endCall', async (e, peer, stream) => {
    console.log('CALL STARTED')

    return endCall(peer, stream)
})

// const { expand_sdp_offer, expand_sdp_answer } = require("./sdp.js")
const Peer = require('simple-peer')

//const wrtc = require('wrtc)')

let emitCall;
let awaiting_callback;
let active_calls = []
let callback;

function parse_sdp (sdp) {

    let ice_ufrag = '';
    let ice_pwd = '';
    let fingerprint = '';
    let ips = [];
    let ports = [];
    let ssrcs = [];
    let msid = "";
    let ip;
    let port;



    let lines = sdp.sdp.split('\n')
        .map(l => l.trim()); // split and remove trailing CR
    lines.forEach(function(line) {

        if (line.includes('a=fingerprint:') && fingerprint == '') {

            let parts = line.substr(14).split(' ');
            let hex = line.substr(22).split(':').map(function (h) {
                return parseInt(h, 16);
            });

            fingerprint = btoa(String.fromCharCode.apply(String, hex))



            console.log('BASED64', fingerprint);


        } else if (line.includes('a=ice-ufrag:') && ice_ufrag == '') {

            ice_ufrag = line.substr(12);


        } else if (line.includes('a=ice-pwd:') && ice_pwd == '') {

            ice_pwd = line.substr(10);

        } else if (line.includes('a=candidate:')) {

            let candidate = line.substr(12).split(" ");

            ip = candidate[4]
            port = candidate[5]
            type = candidate[7]



            let hexa = ip.split('.').map(function (h) {
                return h.toString(16);
            });

            let ip_hex = btoa(String.fromCharCode.apply(String, hexa))
            console.log('IP CODED', ip_hex);

            if (type == "srflx") {
                ip_hex = "!" + ip_hex
            } else {
                ip_hex = "?" + ip_hex
            }

            if (!ips.includes(ip_hex)) {
                ips = ips.concat(ip_hex)

            }

            let indexedport = port+ips.indexOf(ip_hex).toString();

            ports = ports.concat(en.encode(parseInt(indexedport)));


        } else if (line.includes('a=ssrc:')) {

              let ssrc = en.encode(line.substr(7).split(" ")[0]);

             if (!ssrcs.includes(ssrc)) {

               ssrcs = ssrcs.concat(ssrc)

             }


        } else if (line.includes('a=msid-semantic:')) {

             msid = line.substr(16).split(" ")[2];
             console.log('msid', msid);

        }



    })

    return ice_ufrag + "," + ice_pwd + "," + fingerprint + "," + ips.join('&') + "," + ports.join('&') + "," + ssrcs.join('&') + "," + msid;

}


function parseCall (msg, sender, emitCall=true) {
    console.log('🤤🤤🤤🤤🤤🤤',sender)
    switch (msg.substring(0,1)) {
        case "Δ":
        // Fall through
        case "Λ":
            // Call offer
            if (emitCall) {

                // Start ringing sequence

                mainWindow.webContents.send('call-incoming', msg, sender)
                // Handle answer/decline here

                console.log('call incoming')
            }
            return `${msg.substring(0,1) == "Δ" ? "Video" : "Audio"} call started`;
            break;
        case "δ":
        // Fall through
        case "λ":
            // Answer
            if (emitCall) {
                let callback = JSON.stringify(expand_sdp_answer(msg));
                let callerdata = {
                    data: callback,
                    sender: sender
                }
                mainWindow.webContents.send('got-callback', callerdata)
                console.log('got sdp', msg)
            }
            return "";

            break;
        default:
            return msg;

    }

}

let stream;

ipcMain.on('expand-sdp', (e, data) => {
    console.log('INCOMING EXPAND SDP', e, data)
        let recovered_data = expand_sdp_offer(data);
        console.log('TYPE EXPAND_O', recovered_data)
        mainWindow.webContents.send('got-expanded',  recovered_data)
});


ipcMain.on('get-sdp', (e,data) => {
    console.log('get-sdp', data.data, data.type, data.contact, data.video)

    if(data.type == 'offer') {
    console.log('Offer', data.data, data.type, data.contact, data.video)
        let parsed_data = `${data.video ? "Δ" : "Λ"}` + parse_sdp(data.data);
        let recovered_data = expand_sdp_offer(parsed_data);
        console.log('recovered offer data:', recovered_data);
        sendMessage(parsed_data, data.contact)

    } else if (data.type == 'answer') {
    console.log('Answerrrrrrrr',data.data, data.type, data.contact, data.video)
        let parsed_data = `${data.video ? 'δ' : 'λ'}` + parse_sdp(data.data);
        console.log('parsed data really cool sheet:', parsed_data);
        let recovered_data = expand_sdp_answer(parsed_data);
        console.log('recovered data:', recovered_data);
        sendMessage(parsed_data, data.contact)

    }
})


function endCall (peer, stream) {
    try {
        peer.destroy();
        stream.getTracks().forEach(function(track) {
            track.stop();
        });
    } catch (e) {
        console.log('TRACKS', e)
    }

    //var myvideo = document.getElementById('myvideo');

    //myvideo.srcObject = stream;
    //myvideo.pause();
    //myvideo.srcObject = null;

    awaiting_callback = false;

}

function expand_sdp_offer (compressed_string) {

    let type = compressed_string.substring(0,1);

    let split = compressed_string.split(",");

    console.log('split', split);

    let ice_ufrag = split[0].substring(1);

    let ice_pwd = split[1];

    let fingerprint = decode_fingerprint(split[2]);

    console.log('fingerprint', fingerprint);

    let ipss = split[3];

    console.log('IPS', ipss);

    let prts =  split[4];

    let ssrc = split[5].split('&').map(function (h) {
      return en.decode(h);
    });

    console.log('src', ssrc);

    let msid = split[6];

    console.log('msida ', msid);

    let external_ip = '';

    let external_ports = [];

    let candidates = ['','','',''];

    console.log('IPS', ipss)

    let ips = ipss.split('&').map(function (h) {
        return decode_ip(h.substring(1),h.substring(0,1));
    })

    if (ips[0]  === undefined) {
        ips.splice(0, 1);
    }

    if (ips[1]  === undefined) {
        ips.splice(1, 2);
    }

    console.log('IPS SPLIT', ips);

    let ports = prts.split('&').map(function (h) {
        return en.decode(h);
    });

    let prio = 2122260223;

    let tcp_prio = 1518280447;

    let i = 1;
    let j = 1;
    let external_port_found = false;

    let current_internal = '';
    let p;
    for (p in ports) {
        try {
            console.log('port', parseInt(ports[p]));
            let prt = parseInt(ports[p])
            if (!prt) {
                console.log('nanananananaa', prt);
                continue;
            }
            let ip_index = ports[p].slice(-1);
            console.log('ip_index', ip_index);

            if (ips[ip_index] == undefined) {
                continue;
            }

            if (i == 1 ) {

                current_internal = ports[p].substring(0, ports[p].length - 1);

            }

            if (ips[ip_index].substring(0,1) == '!') {
                external_ip = ips[ip_index].substring(1);
                external_ports = external_ports.concat(ports[p].substring(0, ports[p].length - 1));
                console.log('external', external_ports);
                external_port_found = true;
                candidates[j] += "a=candidate:3098175849 1 udp 1686052607 " + ips[ip_index].replace('!','') + " " + ports[p].substring(0, ports[p].length - 1) + " typ srflx raddr " + ips[0].replace('!','').replace('?','') + " rport " + current_internal + " generation 0 network-id 1 network-cost 50\r\n"
            } else if (ports[p].substring(0, ports[p].length - 1) == "9") {

                candidates[j] += "a=candidate:3377426864 1 tcp "  + tcp_prio + " " + ips[ip_index].replace('?','') + " " + ports[p].substring(0, ports[p].length - 1) +  " typ host tcptype active generation 0 network-id 1 network-cost 50\r\n"
                tcp_prio = tcp_prio - 500;

            } else {
                candidates[j] += "a=candidate:1410536466 1 udp " + prio + " " + ips[ip_index].replace('?','') + " " + ports[p].substring(0, ports[p].length - 1) + " typ host generation 0 network-id 1 network-cost 10\r\n"
                prio = parseInt(prio*0.8);
            }


            if ( i == (ports.length / 3) ) {
                i = 0;
                j += 1;
                external_port_found = false;
            }

        } catch (err) {
            console.log('err', err);

            console.log('IPS', ips)
            continue;
        }

        i += 1;

    }

    if (external_ip.length == 0) {
        external_ip = ips[0].substring(1);
    }

    console.log(candidates);
    console.log("ports:", external_ports);

    console.log((external_ports.length / 3));
    console.log(((external_ports.length / 3)*2));

    if (!external_ports[0]) {
        external_ports[0] = "9";
    }

let sdp = `v=0
o=- 5726742634414877819 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1 2
a=extmap-allow-mixed
a=msid-semantic: WMS ` + msid + `
m=audio ` + external_ports[0] + ` UDP/TLS/RTP/SAVPF 111 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 ` + external_ip + `
a=rtcp:9 IN IP4 0.0.0.0
` + candidates[1] +
`a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:5 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:6 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
a=sendrecv
a=msid:` + msid + ` 333cfa17-df46-4ffc-bd9a-bc1c47c90485
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:103 ISAC/16000
a=rtpmap:104 ISAC/32000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:106 CN/32000
a=rtpmap:105 CN/16000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:112 telephone-event/32000
a=rtpmap:113 telephone-event/16000
a=rtpmap:126 telephone-event/8000
a=ssrc:` + ssrc[0] + ` cname:c2J8K3mNIXGEi9qt
a=ssrc:` + ssrc[0] + ` msid:` + msid + ` 333cfa17-df46-4ffc-bd9a-bc1c47c90485
a=ssrc:` + ssrc[0] + ` mslabel:` + msid + `
a=ssrc:` + ssrc[0] + ` label:333cfa17-df46-4ffc-bd9a-bc1c47c90485
m=video ` + external_ports[(external_ports.length / 3)] +  ` UDP/TLS/RTP/SAVPF 102 104 106 108
c=IN IP4 ` + external_ip + `
a=rtcp:9 IN IP4 0.0.0.0
` + candidates[2] +
`a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:actpass
a=mid:1
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:13 urn:3gpp:video-orientation
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:12 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=extmap:11 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type
a=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing
a=extmap:8 http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07
a=extmap:9 http://www.webrtc.org/experiments/rtp-hdrext/color-space
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:5 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:6 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
${type == 'Δ' ? "a=sendrecv\r\na=msid:" + msid + " 0278bd6c-5efa-4fb7-838a-d9ba6a1d8baa" : "a=recvonly" }
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:102 H264/90000
a=rtcp-fb:102 goog-remb
a=rtcp-fb:102 transport-cc
a=rtcp-fb:102 ccm fir
a=rtcp-fb:102 nack
a=rtcp-fb:102 nack pli
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=rtpmap:104 H264/90000
a=rtcp-fb:104 goog-remb
a=rtcp-fb:104 transport-cc
a=rtcp-fb:104 ccm fir
a=rtcp-fb:104 nack
a=rtcp-fb:104 nack pli
a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f
a=rtpmap:106 H264/90000
a=rtcp-fb:106 goog-remb
a=rtcp-fb:106 transport-cc
a=rtcp-fb:106 ccm fir
a=rtcp-fb:106 nack
a=rtcp-fb:106 nack pli
a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:108 H264/90000
a=rtcp-fb:108 goog-remb
a=rtcp-fb:108 transport-cc
a=rtcp-fb:108 ccm fir
a=rtcp-fb:108 nack
a=rtcp-fb:108 nack pli
a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f
${type == "Δ" ?
"a=ssrc:" + ssrc[1] + " cname:qwjy1Thr/obQUvqd\r\n" +
"a=ssrc:" + ssrc[1] + " msid:" + msid + " 6a080e8b-c845-4716-8c42-8ca0ab567ebe\r\n" +
"a=ssrc:" + ssrc[1] + " mslabel:" + msid + "\r\n" +
"a=ssrc:" + ssrc[1] + " label:6a080e8b-c845-4716-8c42-8ca0ab567ebe\r\n" : "" }m=application ` + external_ports[((external_ports.length / 3)*2)] + ` UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 ` + external_ip +  `
` + candidates[3] +
`a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:actpass
a=mid:2
a=sctp-port:5000
a=max-message-size:262144
`

    console.log('ice', ice_ufrag)
    console.log('ice', ice_pwd)
    console.log('fingerprint', fingerprint)
    console.log('SRCS', ssrc)
    console.log('MSID', msid)
    console.log('MSID', candidates)
    return {type: "offer", sdp: sdp};

}

function expand_sdp_answer (compressed_string) {

    let split = compressed_string.split(",");

    console.log("split:", split);

    let type = compressed_string.substring(0,1);

    let ice_ufrag = split[0].substring(1);

    let ice_pwd = split[1];

    let fingerprint = decode_fingerprint(split[2]);

    let ips = split[3];

    console.log('ips1', ips)

    let prts =  split[4];

    let ssrc = split[5].split('&').map(function (h) {
      return en.decode(h);
    });


   if (ssrc[1] == undefined) {
     ssrc[1] = ssrc[0];
     }

    let msid = split[6];

    let candidates = '';

    let external_ip = '';

    ips = ips.split('&').map(function (h) {
        return decode_ip(h.substring(1),h.substring(0,1));
    })

    if (ips[0]  === undefined) {
        ips.splice(0, 1);
    }

    if (ips[1]  === undefined) {
        ips.splice(1, 2);
    }

    let ports = prts.split('&').map(function (h) {
        return en.decode(h);
    });;

    let external_port = '';

    console.log("ips:", ips);
    console.log("ports:", ports);

    let prio = 2122260223;
    let tcp_prio = 1518280447;
    if (ports.length > 1) {

        console.log('More than 1 port!');
        let p;
        for (p in ports) {
          try {
              console.log('port', parseInt(ports[p]));
              let prt = parseInt(ports[p])
              if (!prt) {
                  console.log('nanananananaa', prt);
                  continue;
              }
              let ip_index = ports[p].slice(-1);
              console.log('ip_index', ip_index);

              if (ips[ip_index] == undefined) {
                  continue;
              }

                if (ips[ip_index].substring(0,1) == '!') {
                    if (external_port.length == 0) {
                        external_port = ports[p].substring(0, ports[p].length - 1);
                    }
                    external_ip = ips[ip_index].substring(1);
                    candidates += "a=candidate:3098175849 1 udp 1686052607 " + ips[ip_index].replace('!','') + " " + ports[p].substring(0, ports[p].length - 1)  + " typ srflx raddr " + ips[0].replace('?','') + " rport " + ports[0].substring(0, ports[p].length - 1)  + " generation 0 network-id 1 network-cost 50\r\n"
                } else if (ports[p].substring(0, ports[p].length - 1)  == "9") {

                    candidates += "a=candidate:3377426864 1 tcp "  + tcp_prio + " " + ips[ip_index].replace('?','').replace('!','') + " " + ports[p].substring(0, ports[p].length - 1)  +  " typ host tcptype active generation 0 network-id 1 network-cost 50\r\n"
                    tcp_prio = tcp_prio - 500;

                } else {

                    candidates += "a=candidate:1410536466 1 udp " + prio + " " + ips[ip_index].replace('?','') + " " + ports[p].substring(0, ports[p].length - 1)  + " typ host generation 0 network-id 1 network-cost 10\r\n"
                    prio = parseInt(prio*0.8);
                }

            } catch (err) {
                console.log('err', err);
                continue;
            }

        }
    } else {

        external_ip = ips[0].replace('!','').replace('?','');

        external_port = ports[0].substring(0, ports[0].length - 1) ;
        candidates = "a=candidate:1410536466 1 udp 2122260223 " + ips[0].replace('!','').replace('?','') + " " + ports[0].substring(0, ports[0].length - 1)  + " typ host generation 0 network-id 1 network-cost 10\r\n"
    }

    if (external_port == "") {
        external_port = "9";
    }

let sdp = `v=0
o=- 8377786102162672707 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1 2
a=msid-semantic: WMS ` + msid + `
m=audio ` + external_port + ` UDP/TLS/RTP/SAVPF 111 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 ` + external_ip + `
a=rtcp:9 IN IP4 0.0.0.0
` + candidates +
`a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:active
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:5 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:6 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
a=sendrecv
a=msid:` + msid + ` a18f5f6a-2e4e-4012-8caa-8c28936bdb66
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:103 ISAC/16000
a=rtpmap:104 ISAC/32000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:106 CN/32000
a=rtpmap:105 CN/16000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:112 telephone-event/32000
a=rtpmap:113 telephone-event/16000
a=rtpmap:126 telephone-event/8000
m=video 9 UDP/TLS/RTP/SAVPF 102 104 106 108
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:active
a=mid:1
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:13 urn:3gpp:video-orientation
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:12 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=extmap:11 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type
a=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing
a=extmap:8 http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07
a=extmap:9 http://www.webrtc.org/experiments/rtp-hdrext/color-space
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:5 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:6 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
${type == 'δ' ? "a=sendrecv\r\na=msid:" + msid + " 06691570-5673-40ba-a027-72001bbc6f70" : "a=inactive"}
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:102 H264/90000
a=rtcp-fb:102 goog-remb
a=rtcp-fb:102 transport-cc
a=rtcp-fb:102 ccm fir
a=rtcp-fb:102 nack
a=rtcp-fb:102 nack pli
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=rtpmap:104 H264/90000
a=rtcp-fb:104 goog-remb
a=rtcp-fb:104 transport-cc
a=rtcp-fb:104 ccm fir
a=rtcp-fb:104 nack
a=rtcp-fb:104 nack pli
a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f
a=rtpmap:106 H264/90000
a=rtcp-fb:106 goog-remb
a=rtcp-fb:106 transport-cc
a=rtcp-fb:106 ccm fir
a=rtcp-fb:106 nack
a=rtcp-fb:106 nack pli
a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:108 H264/90000
a=rtcp-fb:108 goog-remb
a=rtcp-fb:108 transport-cc
a=rtcp-fb:108 ccm fir
a=rtcp-fb:108 nack
a=rtcp-fb:108 nack pli
a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f
a=ssrc:` + ssrc[1] + ` cname:0v7phLz3L82cIhVT
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
b=AS:30
a=ice-ufrag:` + ice_ufrag + `
a=ice-pwd:` + ice_pwd + `
a=fingerprint:sha-256 ` + fingerprint +  `
a=setup:active
a=mid:2
a=sctp-port:5000
a=max-message-size:262144
`


    return {type: 'answer', sdp: sdp}
}


let decode_fingerprint = (fingerprint) => {
    console.log('fingerprint', fingerprint);
    let decoded_fingerprint = "";
    let piece;
    let letters = atob(fingerprint).split('')
    for (letter in letters) {
        try {

            let piece = letters[letter].charCodeAt(0).toString(16);
            console.log('del', piece);
            if (piece.length == 1) {
                piece = "0" + piece;
            }
            decoded_fingerprint += piece;



        } catch (err) {
            console.log('error', piece)
            console.log('error', letter)

            continue;
        }
    }
    console.log('almost', decoded_fingerprint) ;

    decoded_fingerprint = decoded_fingerprint.toUpperCase().replace(/(.{2})/g,"$1:").slice(0,-1);

    console.log('There', decoded_fingerprint) ;

    return decoded_fingerprint;
}

let decode_ip = (ip, type) => {
  let decoded_ip = "";

  for (letter in atob(ip).split('')) {

    let piece = atob(ip).split('')[letter].charCodeAt(0).toString(16);
    if (piece.length == 1) {
      piece = "0" + piece;
    }
    decoded_ip += parseInt(piece, 16) + ".";


  }


  return type+decoded_ip.slice(0,-1);
}
