#!/usr/bin/node

var Amount    = require("ripple-lib").Amount;
var Currency  = require("ripple-lib").Currency;
var Remote    = require("ripple-lib").Remote;
var irc	      = require("irc");

var remote_config = {
  'trusted' : true,
  'websocket_ip' : "127.0.0.1",
  'websocket_port' : 7005,
  'websocket_ssl' : false,
  'local_sequence' : true,
  'local_fee' : true,
};

var client = new irc.Client('irc.freenode.net', 'ripplebot', {
    userName: "ripplebot",
    realName: "Ripple IRC Bot",
    channels: ['#ripple-market', '#ripple-watch'],
});

client.on('registered', function(message) {
    console.log("registered: ", message);

    client.join("#ripple-watch", function() {
        self.irc  = true;

        console.log("*** Connected to : irc");
      });
  });
    
client.on('error', function(message) {
    console.log("error: ", message);
});

var self  = this;

    self.totalCoins = undefined;

var remote  =
  Remote
    .from_config(remote_config, true)
    .once('ledger_closed', function (m) {
        self.rippled  = true;

        console.log("*** Connected to : rippled");
      })
    .on('error', function (m) {
        console.log("*** rippled: error: ", JSON.stringify(m));
      })
    .on('ledger_closed', function (m) {
        console.log("ledger: ", JSON.stringify(m));

        remote.request_ledger_header()
          .ledger_index(m.ledger_index)
          .on('error', function (m) {})
          .on('success', function (lh) {
              if (self.totalCoins !== lh.ledger.totalCoins) {
                self.totalCoins = lh.ledger.totalCoins;

                self.totalCoins.match(/^(.*)(......)$/);

                var matches = lh.ledger.totalCoins.match(/^(.*)(......)$/);
                var xrp_whole   = matches[1];
                var xrp_fraction  = matches[2];

                // console.log("ledger_header: ", JSON.stringify(lh));

                client.say("#ripple-watch",
                  "Ledger #" + m.ledger_index
                  + " Total XRP: " + xrp_whole + "." + xrp_fraction);
              }
            })
          .request()
      })
    .on('transaction', function (m) {
        console.log("transaction: ", JSON.stringify(m, undefined, 2));

        var say;

        var prefix  = m.engine_result === 'tesSUCCESS'
          ? ""
          : m.engine_result + ": ";

        if (!self.irc) {
          // nothing();
        }
        else if (m.transaction.TransactionType === 'Payment')
        {
          var amount    = Amount.from_json(m.transaction.Amount);
          var currency  = amount.currency();

          say = amount.to_human()
                  + " "
                  + currency.to_human()
                  + " "
                  + m.transaction.Account + " > " + m.transaction.Destination;
        }
        else if (m.transaction.TransactionType === 'AccountSet')
        {
          say = m.transaction.Account;
        }
        else if (m.transaction.TransactionType === 'TrustSet')
        {
          var amount    = Amount.from_json(m.transaction.LimitAmount);
          var currency  = amount.currency();

          say = amount.to_human()
                  + " "
                  + currency.to_human()
                  + " "
                  + m.transaction.Account + " > " + m.transaction.LimitAmount.issuer;
        }
        else if (m.transaction.TransactionType === 'OfferCreate')
        {
//     "TakerGets": {
//       "currency": "AUD",
//       "issuer": "rBcYpuDT1aXNo4jnqczWJTytKGdBGufsre",
//       "value": "0.1"
//     },
//     "TakerPays": "2000000000",
//     "TransactionType": "OfferCreate",
          say = m.transaction.Account;
        }
        else if (m.transaction.TransactionType === 'OfferCancel')
        {
          say = m.transaction.Account;
        }

        if (say)
        {
          client.say("#ripple-watch",
              (m.engine_result === 'tesSUCCESS'
                ? ""
                : m.engine_result + ": ")
              + m.transaction.TransactionType + " "
              + say);
        }
      })
  .connect();

// vim:sw=2:sts=2:ts=8:et
