#!/usr/bin/node

var Amount        = require("ripple-lib").Amount;
var Currency      = require("ripple-lib").Currency;
var Remote        = require("ripple-lib").Remote;
var UInt160       = require("ripple-lib").UInt160;
var extend	  = require("extend");
var irc	          = require("irc");
var gateways      = require("./config").gateways;
var irc_config    = require("./config").irc_config;
var remote_config = require("./config").remote_config;

var self  = this;

self.totalCoins = undefined;

var client = new irc.Client('irc.freenode.net', 'ripplebot', {
    userName: "ripplebot",
    realName: "Ripple IRC Bot",
    channels: ['#ripple-market', '#ripple-watch'],
    autoConnect: irc_config.enable,
});

client
  .on('error', function(message) {
      console.log("*** irc error: ", message);
    })
  .on('registered', function(message) {
      console.log("registered: ", message);

      client.join("#ripple-watch", function() {
          self.irc  = true;

          console.log("*** Connected to irc");
        });
    });
    
var writeMarket = function (message) {
  if (message)
  {
    console.log("M: " + message);

    if (self.irc) {
      client.say("#ripple-market", message);
    }
  }
}

var writeWatch = function (message) {
  if (message)
  {
    console.log("W: " + message);

    if (self.irc) {
      client.say("#ripple-watch", message);
    }
  }
}

var remote  =
  Remote
    .from_config(remote_config)
    .once('ledger_closed', function (m) {
        self.rippled  = true;

        console.log("*** Connected to rippled");
      })
    .on('error', function (m) {
        console.log("*** rippled error: ", JSON.stringify(m));
      })
    .on('ledger_closed', function (m) {
        // console.log("ledger: ", JSON.stringify(m));

        remote.request_ledger_header()
          .ledger_index(m.ledger_index)
          .on('error', function (m) {})
          .on('success', function (lh) {
              if (self.totalCoins !== lh.ledger.totalCoins) {
                self.totalCoins = lh.ledger.totalCoins;

                // console.log("ledger_header: ", JSON.stringify(lh));

                writeWatch("Ledger #" + m.ledger_index + " Total XRP: " + Amount.from_json(self.totalCoins).to_human());
              }
            })
          .request()
      })
    .on('transaction', function (m) {
        var say_watch;

        if (m.transaction.TransactionType === 'Payment')
        {
          var amount    = Amount.from_json(m.transaction.Amount);
          var currency  = amount.currency();

          say_watch = amount.to_human_full({ gateways: gateways })
                  + " "
                  + m.transaction.Account + " > " + m.transaction.Destination;
        }
        else if (m.transaction.TransactionType === 'AccountSet')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = m.transaction.Account;
        }
        else if (m.transaction.TransactionType === 'TrustSet')
        {
          var amount    = Amount.from_json(m.transaction.LimitAmount);
          var currency  = amount.currency();

          say_watch = amount.to_human()
                  + "/"
                  + currency.to_human()
                  + " "
                  + m.transaction.Account + " > " + m.transaction.LimitAmount.issuer;
        }
        else if (m.transaction.TransactionType === 'OfferCreate')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = m.transaction.Account
                + " offers " + Amount.from_json(m.transaction.TakerGets).to_human_full({ gateways: gateways })
                + " for " + Amount.from_json(m.transaction.TakerPays).to_human_full({ gateways: gateways });

          if (m.engine_result === 'tesSUCCESS')
          {
            m.meta.AffectedNodes.forEach(function (n) {
                var type;
                
                if ('ModifiedNode' in n)
                  type  = 'ModifiedNode';
                else if ('DeletedNode' in n)
                  type  = 'DeletedNode';

                var base  = type ? n[type] : undefined;
                
                if (base && base.LedgerEntryType === 'Offer') {
                  var pf  = base.PreviousFields;
                  var ff  = base.FinalFields;

                  var taker_got   = Amount.from_json(pf.TakerGets).subtract(Amount.from_json(ff.TakerGets));
                  var taker_paid  = Amount.from_json(pf.TakerPays).subtract(Amount.from_json(ff.TakerPays));

                  if (taker_got.is_native())
                  {
                    [taker_got, taker_paid] = [taker_paid, taker_got];
                  }

                  if (taker_paid.is_native())
                  {
                    var gateway = gateways[taker_got.issuer().to_json()];

                    if (gateway)
                    {
                      writeMarket(
                          gateway
                          + " " + taker_paid.to_human()
                          + " @ " + taker_got.multiply(Amount.from_json("1000000")).divide(taker_paid).to_human()
                          + " " + taker_got.currency().to_human()
                        );
                    }
                    else
                    {
                      // Ignore non-reknown issuer.
                    }
//                    writeMarket(
//                      taker_paid.to_human_full({ gateways: gateways })
//                      + " for "
//                      + taker_got.to_human_full({ gateways: gateways })
//                      );
                  }
                  else
                  {
                    // Ignore IOU for IOU.
console.log("*: ignore");
                  }
                }
              });
          }
        }
        else if (m.transaction.TransactionType === 'OfferCancel')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = m.transaction.Account;
        }

        if (say_watch)
        {
          var output  =
              (m.engine_result === 'tesSUCCESS'
                ? ""
                : m.engine_result + ": ")
              + m.transaction.TransactionType + " "
              + say_watch;

          writeWatch(output);
        }
      })
  .connect();

// vim:sw=2:sts=2:ts=8:et
