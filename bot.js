#!/usr/bin/node

var Amount        = require("ripple-lib").Amount;
var Currency      = require("ripple-lib").Currency;
var Remote        = require("ripple-lib").Remote;
var UInt160       = require("ripple-lib").UInt160;
var async	  = require("async");
var extend	  = require("extend");
var irc	          = require("irc");
var gateways      = require("./config").gateways;
var hotwallets    = require("./config").hotwallets;
var irc_config    = require("./config").irc_config;
var remote_config = require("./config").remote_config;

// extend(require("ripple-lib/src/js/config"), require("./config"));

var self  = this;

self.totalCoins   = undefined;
self.load_factor  = undefined;

var remote;
var gateway_addresses = extend(extend({}, gateways), hotwallets);
var opts_gateways = {
  'gateways' : gateway_addresses
};

var color_diff  = {
  '-1' : 'dark_red',
   '0' : 'black',
   '1' : 'dark_green'
};

var colorize  = function (channel, text, delta) {
  return 'irc' === channel
//    ? irc.colors.wrap(color_diff[delta], text)
    ? irc.colors.wrap('light_green', text)
    : delta
      ? delta == -1
        ? ">" + text + "<"
        : "<" + text + ">"
      : "|" + text + "|";
};

//
// USD=958: weex=458 bitstamp=500
//

var capital = {
  // Structured for updating by gatway.
  // gateway : { currency : amount }
};

// <-- _summary: { gateway : { balances : { currency : amount } } }
var account_update = function (callback, ledger_hash, address) {
    // console.log("address: %s", address);

    remote
      .request_account_lines(address)
      .ledger_hash(ledger_hash)
      .on('error', function (m) {
          console.log("error: %s >>> %s", address, JSON.stringify(m, undefined, 2));
          callback(m);
        })
      .on('success', function (m) {
          // console.log("lines: %s", address);
          // console.log("lines: %s >>> %s", address, JSON.stringify(m, undefined, 2));

          var _summary    = {};
          var _gateway    = gateways[address];

          if (!(_gateway in _summary))
            _summary[_gateway]  = {};

          var _summary_gateway  = _summary[_gateway];

          for (var i = m.lines.length; i--;)
          {
            var line = m.lines[i];

            // console.log("line: %s", JSON.stringify(line, undefined, 2));

            var _value    = (new Amount())
                              .set_currency(line.currency)
                              .set_issuer(UInt160.ADDRESS_ONE)
                              .parse_value(line.balance);

            if (!_value.is_zero() && !(line.account in hotwallets))
            {
              _summary_gateway[line.currency] = line.currency in _summary_gateway
                ? _summary_gateway[line.currency].add(_value)
                : _value;
//              console.log("line: %s / %s / %s", _value.is_zero(), _value.to_human(), _summary_gateway[line.currency].to_human());
            }
          }

          // XXX Remove negative entries from _summary

          callback(undefined, _summary);
        })
      .request();
};

var update_results = function (results) {
  // Merge results.
  var _merged             = {};
  var _merged_currencies  = {};

  for (var i = results.length; i--;)
  {
    var _summary    = results[i];
    // console.log("i: %s _summary: %s", i, JSON.stringify(_summary, undefined, 2));
    var _gateways   = Object.keys(_summary);

    for (var j = _gateways.length; j--;)
    {
      var _gateway    = _gateways[j];
      var _currencies = Object.keys(_summary[_gateway]);

      for (var k = _currencies.length; k--;)
      {
        var _currency = _currencies[k];
        var _balance  = _summary[_gateway][_currency];

        if (_balance.is_negative())
        {
          if (!(_gateway in _merged))
            _merged[_gateway]  = {};

          _merged[_gateway][_currency] = _currency in _merged[_gateway]
            ? _merged[_gateway]._currency.add(_balance)
            : _balance;

          _merged_currencies[_currency] = true;
        }
      }
    }
  }

  // console.log("merged: ", JSON.stringify(_merged, undefined, 2));
  // console.log("merged_currencies: ", JSON.stringify(_merged_currencies, undefined, 2));

  var _gateways   = Object.keys(_merged).sort().reverse();
  var _currencies = Object.keys(_merged_currencies).sort().reverse();

  for (var i = _currencies.length; i--;)
  {
    var _currency = _currencies[i];
    // XXX Is there any easier way to set something to zero?
    var _total    = (new Amount())
                      .parse_value('0')
                      .set_currency(_currency)
                      .set_issuer(UInt160.ADDRESS_ONE);

    var _each       = [];
    var _each_irc   = [];
    var _changed    = false;

    for (var j = _gateways.length; j--;)
    {
      var _gateway = _gateways[j];

      if (_merged[_gateway][_currency])
      {
        var _balance      = _merged[_gateway][_currency].negate();
        var _balance_diff = !capital[_currency] || !capital[_currency][_gateway]
                              ? 1
                              : _balance.compareTo(capital[_currency][_gateway]);


        if (_balance_diff)
          _changed  = true;

        _each.push(_gateway + "=" + colorize('console', _balance.to_human(), _balance_diff));
        _each_irc.push(_gateway + "=" + colorize('irc', _balance.to_human(), _balance_diff));

        if (!capital[_currency])
          capital[_currency]  = {};

        capital[_currency][_gateway] = _balance;

        _total  = _total.add(_balance);
      }
    }

    var _total_diff   = !capital[_currency] || !capital[_currency]._total ? 1 : _total.compareTo(capital[_currency]._total);

    if (_total_diff)
    {
      _changed  = true;
    }

    if (!capital[_currency])
      capital[_currency]  = {};
     
    capital[_currency]._total = _total;

    if (_changed)
    {
      var _output     = _currency + "=" + colorize('console', _total.to_human(), _total_diff) + ": " +_each.join(" ");
      var _output_irc  = _currency + "=" + colorize('irc', _total.to_human(), _total_diff) + ": " +_each_irc.join(" ");

      writeMarket(_output_irc, _output);
    }
  }
}

var capital_update = function (ledger_hash) {
  // On ledger_closed we get the account lines of gateways and find their capitalization.

  var keys  = Object.keys(gateways);

  // console.log("capital_update: %s : [%s]", ledger_hash, keys.join(", "));

  async.map(keys,
      function (address, callback) {
        account_update(callback, ledger_hash, address);
      },
      function (err, results) {
        // console.log("results: ", JSON.stringify(results, undefined, 2));

        if (!err)
        {
          update_results(results);
        }
      }
    );
};

//
// irc client
//

var client;
    
var actionMarket = function (message) {
  if (message)
  {
    console.log("m: " + message);

    if (self.irc_market) {
      client.action("#ripple-market", message);
    }
  }
}

var actionWatch = function (message) {
  if (message)
  {
    console.log("w: " + message);

    if (self.irc_watch)
    {
      client.action("#ripple-watch", message);
    }
  }
}

var actionAll = function (message) {
  actionMarket(message);
  actionWatch(message);
}

var writeMarket = function (message, plain) {
  if (message)
  {
    console.log("M: " + (plain ? plain: message));

    if (self.irc_market) {
      client.say("#ripple-market", message);
    }
  }
}

var writeWatch = function (message) {
  if (message)
  {
    console.log("W: " + message);

    if (self.irc_watch) {
      client.say("#ripple-watch", message);
    }
  }
}

var process_offers  = function (m) {
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

          if (!pf)
          {
            console.log("process_offers: NO pf! %s", JSON.stringify(m, undefined, 2));
          }
          else
          {
            var taker_got   = Amount.from_json(pf.TakerGets).subtract(Amount.from_json(ff.TakerGets));
            var taker_paid  = Amount.from_json(pf.TakerPays).subtract(Amount.from_json(ff.TakerPays));

            if (taker_got.is_native())
            {
              var tg  = taker_got;
              var tp  = taker_paid;

              taker_got   = tp;
              taker_paid  = tg;
            }

            if (taker_paid.is_native())
            {
              var gateway = gateways[taker_got.issuer().to_json()];

              if (gateway)
              {
                writeMarket(
                    "TRD "
                      + gateway
                      + " " + taker_paid.to_human()
                      + " @ " + taker_got.multiply(Amount.from_json("1000000")).divide(taker_paid).to_human()
                      + " " + taker_got.currency().to_human()
                  );
              }
              else
              {
                // Ignore unrenowned issuer.
              }
            }
            else
            {
              // Ignore IOU for IOU.
console.log("*: ignore");
//          writeMarket(
//            taker_paid.to_human_full()
//            + " for "
//            + taker_got.to_human_full()
//            );
            }
          }
        }
      });
  }
}

remote  =
  Remote
    .from_config(remote_config)
    .once('ledger_closed', function (m) {
        self.rippled  = true;

        console.log("*** Connected to rippled");
      })
    .on('error', function (m) {
        console.log("*** rippled error: ", JSON.stringify(m));
      })
    .on('state', function (s) {
        if ('online' === s)
        {
          actionAll("is connected to the Ripple network. :)");  
        }
        else if ('offline' === s)
        {
          actionAll("is disconnected from the Ripple network. :(");  
        }
      })
    .on('load', function (m) {
        if (!self.load_factor)
        {
          self.load_factor  = m.load_factor;
        }
        else if (self.load_factor !== m.load_factor)
        {
          self.load_factor  = m.load_factor;

          actionWatch("load factor: " + self.load_factor);
        }
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

                actionWatch("on ledger #" + m.ledger_index + ". Total: " + Amount.from_json(self.totalCoins).to_human() + "/XRP");
              }
            })
          .request()

        capital_update(m.ledger_hash);
      })
    .on('transaction', function (m) {
        var say_watch;

        if (m.transaction.TransactionType === 'Payment')
        {
          // XXX Show tags?
          // XXX Break payments down by parts.

          say_watch = Amount.from_json(m.transaction.Amount).to_human_full(opts_gateways)
                  + " "
                  + UInt160.json_rewrite(m.transaction.Account, opts_gateways)
                    + " > "
                    + UInt160.json_rewrite(m.transaction.Destination, opts_gateways);

          process_offers(m);
        }
        else if (m.transaction.TransactionType === 'AccountSet')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways);
        }
        else if (m.transaction.TransactionType === 'TrustSet')
        {
          say_watch = Amount.from_json(m.transaction.LimitAmount).to_human_full(opts_gateways)
                        + " "
                        + UInt160.json_rewrite(m.transaction.Account, opts_gateways);
        }
        else if (m.transaction.TransactionType === 'OfferCreate')
        {
          // console.log("transaction: ", JSON.stringify(m, undefined, 2));

          var owner        = UInt160.json_rewrite(m.transaction.Account, opts_gateways);
          var taker_gets  = Amount.from_json(m.transaction.TakerGets);
          var taker_pays  = Amount.from_json(m.transaction.TakerPays);

          say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways)
                + " #" + m.transaction.Sequence
                + " offers " + taker_gets.to_human_full(opts_gateways)
                + " for " + taker_pays.to_human_full(opts_gateways);

          if (taker_gets.is_native() || taker_pays.is_native())
          {
            var what    = taker_gets.is_native()
                            ? 'ASK'
                            : 'BID';
            var xrp     = taker_gets.is_native()
                            ? taker_gets
                            : taker_pays;
            var amount  = taker_gets.is_native()
                            ? taker_pays
                            : taker_gets;

            var gateway = gateways[amount.issuer().to_json()];

            if (gateway)
            {
              writeMarket(
                    what
                      + " " + gateway
                      + " " + xrp.to_human()
                      + " @ " + amount.ratio_human(xrp).to_human()
                      + " " + amount.currency().to_human()
                      + " " + owner + " #" + m.transaction.Sequence
                );
            }
          }

//  weex   2000 @ 0.10 BTC Bid WHO #4
//  weex   2000 @ 0.10 BTC Ask WHO #4
//  weex 9,749.99998 @ 0.00003663003663003658 BTC Trade
          process_offers(m);
        }
        else if (m.transaction.TransactionType === 'OfferCancel')
        {
          // console.log("transaction: ", JSON.stringify(m, undefined, 2));
// TODO:
//  weex   2000 @ 0.10 BTC Bid WHP #4 Cancel

          say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways)
                + " #" + m.transaction.OfferSequence;
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
      });

var client = new irc.Client('irc.freenode.net', 'ripplebot', {
    userName: "ripplebot",
    realName: "Ripple IRC Bot",
//    channels: ['#ripple-market', '#ripple-watch'],
    autoConnect: irc_config.enable,
    stripColors: false,
    floodProtection: true,
});

client
  .on('error', function(message) {
      console.log("*** irc error: ", message);
    })
  .once('registered', function(message) {
      console.log("registered: ", message);

      if (irc_config.enable)
      {
        client.join("#ripple-watch", function() {
            self.irc_watch  = true;

            console.log("*** Connected to #ripple-watch");

            if (self.irc_market)
              remote.connect();
          });
        client.join("#ripple-market", function() {
            self.irc_market  = true;

            console.log("*** Connected to #ripple-market");

            if (self.irc_watch)
              remote.connect();
          });
      }
    });

if (!irc_config.enable)
{
  remote.connect();
}
// vim:sw=2:sts=2:ts=8:et
