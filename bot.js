#!/usr/bin/node

var Amount    = require("../src/js/amount.js").Amount;
var Currency  = require("../src/js/amount.js").Currency;
var Remote    = require("../src/js/remote.js").Remote;
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
        main('irc');
      });

  });
    
client.on('error', function(message) {
    console.log("error: ", message);
});

var remote  = Remote
              .from_config(remote_config, true)
              .once('ledger_closed', function (m) {
                  main('rippled');
                })
              .connect();

var main = function (system) {
  var self  = this;

  if (!this.started)
    this.started = {};

  this.started[system]  = true;

  console.log("*** Connected to : ", system);

  if (this.started.irc && this.started.rippled)
  {
    client.say("#ripple-watch", "Hello, Nurse!");

    remote.on('transaction', function (m) {
        console.log("transaction: ", JSON.stringify(m, undefined, 2));

        var prefix  = m.engine_result === 'tesSUCCESS'
          ? ""
          : m.engine_result + ": ";

        if (m.transaction.TransactionType === 'Payment')
        {
          var amount    = Amount.from_json(m.transaction.Amount);
          var currency  = amount.currency();

          client.say("#ripple-watch",
            prefix
              + "Payment "
              + amount.to_human() + " " + currency.to_human()
              + " " + m.transaction.Account + " > " + m.transaction.Destination);
        }
        else if (m.transaction.TransactionType === 'AccountSet')
        {
          client.say("#ripple-watch",
            prefix
              + "AccountSet " + m.transaction.Account);
        }
        else if (m.transaction.TransactionType === 'TrustSet')
        {
          client.say("#ripple-watch",
            prefix
              + "TrustSet " + m.transaction.Account);
        }
        else if (m.transaction.TransactionType === 'OfferCreate')
        {
          client.say("#ripple-watch",
            prefix
              + "OfferCreate " + m.transaction.Account);
        }
        else if (m.transaction.TransactionType === 'OfferCancel')
        {
          client.say("#ripple-watch",
            prefix
              + "OfferCancel " + m.transaction.Account);
        }
      });

    self.totalCoins = undefined;

    remote.on('ledger_closed', function (m) {
        console.log("ledger: ", JSON.stringify(m));

        remote.request_ledger_header()
          .ledger_index(m.ledger_index)
          .on('success', function (lh) {
              if (self.totalCoins !== lh.ledger.totalCoins) {
                self.totalCoins = lh.ledger.totalCoins;

                self.totalCoins.match(/^(.*)(......)$/);

                var matches = lh.ledger.totalCoins.match(/^(.*)(......)$/);
                var xrp_whole   = matches[1];
                var xrp_fraction  = matches[2];

                // console.log("ledger_header: ", JSON.stringify(lh));

                client.say("#ripple-watch",
                  "#" + m.ledger_index
                  + " XRP: " + xrp_whole + "." + xrp_fraction);
              }
            })
          .request()
      });
  }
};

// vim:sw=2:sts=2:ts=8:et
