#!/usr/bin/node

var Amount        = require("ripple-lib").Amount;
var Currency      = require("ripple-lib").Currency;
var Remote        = require("ripple-lib").Remote;
var Transaction   = require("ripple-lib").Transaction;
var UInt160       = require("ripple-lib").UInt160;
var async         = require("async");
var extend        = require("extend");
var irc           = require("irc");
var gateways      = require("./config").gateways;
var hotwallets    = require("./config").hotwallets;
var irc_config    = require("./config").irc_config;
var remote_config = require("./config").remote_config;

// extend(require("ripple-lib/src/js/config"), require("./config"));

var self  = this;

self.total_coins  = undefined;
self.load_factor  = undefined;

var remote;
var gateway_addresses = extend(extend({}, gateways), hotwallets);
var opts_gateways = {
  'gateways' : gateway_addresses
};

var color_diff  = {
  '-1' : 'light_red',
   '0' : 'black',
   '1' : 'light_green'
};

var colorize  = function (channel, text, delta) {
  return 'irc' === channel
    ? irc.colors.wrap(color_diff[delta], text)
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
      var _output     = "CAP " + _currency + "=" + colorize('console', _total.to_human(), _total_diff) + ": " +_each.join(" ");
      var _output_irc  = "CAP " + _currency + "=" + colorize('irc', _total.to_human(), _total_diff) + ": " +_each_irc.join(" ");

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
    console.log("M: " + (plain ? plain : message));

    if (self.irc_market) {
      client.say("#ripple-market", message);
    }
  }
}

var writeWatch = function (message, plain) {
  if (message)
  {
    console.log("W: " + (plain ? plain : message));

    if (self.irc_watch) {
      client.say("#ripple-watch", message);
    }
  }
}

var process_offers  = function (m) {
  if (m.meta.TransactionResult === 'tesSUCCESS')
  {
    var taker   = m.transaction.Account;
    var trades  = [];
    var buying  = false;

    m.meta.AffectedNodes.forEach(function (n) {
        var type;
        
        if ('ModifiedNode' in n)
          type  = 'ModifiedNode';
        else if ('DeletedNode' in n)
          type  = 'DeletedNode';

        var base  = type ? n[type] : undefined;
        
        if (base                                  // A relevant type.
          && base.LedgerEntryType === 'Offer'
          && base.PreviousFields                  // Not an unfunded delete.
          && 'TakerGets' in base.PreviousFields     // Not a microscopic offer
          && 'TakerPays' in base.PreviousFields) {  // Not a microscopic offer
          var pf              = base.PreviousFields;
          var ff              = base.FinalFields;
          var offer_owner     = ff.Account;
          var offer_sequence  = ff.Sequence;
          var taker_got       = Amount.from_json(pf.TakerGets).subtract(Amount.from_json(ff.TakerGets));
          var taker_paid      = Amount.from_json(pf.TakerPays).subtract(Amount.from_json(ff.TakerPays));
          var book_price      = Amount.from_quality(ff.BookDirectory, "1", "1");

          if (taker_got.is_native())
          {
            buying      = true;
            book_price  = book_price.multiply(Amount.from_json("1000000")); // Adjust for drops: The result would be a million times too small.
            book_price  = Amount.from_json("1.0/1/1").divide(book_price);

            var tg  = taker_got;
            var tp  = taker_paid;

            taker_got   = tp;
            taker_paid  = tg;
          }
          else
          {
            book_price  = book_price.divide(Amount.from_json("1000000")); // Adjust for drops: The result would be a million times too large.
          }

          if (taker_paid.is_native())
          {

            var gateway = gateways[taker_got.issuer().to_json()];

            if (gateway)
            {
              var n = {
                  gateway:        gateway,
                  taker_paid:     taker_paid,
                  book_price:     book_price,
                  taker_got:      taker_got,
                  offer_owner:    offer_owner,
                  offer_sequence: offer_sequence,
                  sort:           Number(book_price.to_human({
                                      precision: 8,
                                      group_sep: false,
                                    })),
                };
              trades.push(n);
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
          }
        }
      });

    trades.sort(buying
        ? function (a,b) { return b.sort-a.sort; }  // Normal order: lowest first
        : function (a,b) { return a.sort-b.sort; }  // Reverse.
      );

    trades.forEach(function (t) {
      console.log("taker_paid: %s taker_got: %s", t.taker_paid.to_human_full(), t.taker_got.to_human_full());

// + " @ " + taker_got.multiply(Amount.from_json("1000000")).divide(taker_paid).to_human()
      var trade_irc =
          "TRD \u0002"
            + t.gateway
            + "\u000f " + t.taker_paid.to_human()
            + " @ \u0002" + t.book_price.to_human() // taker_paid.divide(taker_got)
            + "\u000f " + t.taker_got.currency().to_human()
            + " " + t.offer_owner
            + " #" + t.offer_sequence;

      var trade_console =
          "TRD "
            + t.gateway
            + " " + t.taker_paid.to_human()
            + " @ " + t.book_price.to_human()       // taker_paid.divide(taker_got)
            + " " + t.taker_got.currency().to_human()
            + " " + t.offer_owner
            + " #" + t.offer_sequence;

      writeMarket(trade_irc, trade_console);
    });
  }
}

var process_tx  = function (m) {
  var say_watch;
  var say_watch_irc;
  var say_type  = m.transaction.TransactionType;
  var fee       = Number(m.transaction.Fee);

  // console.log("m: %s", JSON.stringify(m, undefined, 2));

  if (m.transaction.TransactionType === 'Payment')
  {
    // XXX Break payments down by parts.
    // console.log(m);

    var created = m.meta
      && m.meta.AffectedNodes.filter(function (node) {
        return node.CreatedNode
          && node.CreatedNode.LedgerEntryType === 'AccountRoot'
          && node.CreatedNode.NewFields.Account === m.transaction.Destination;
      }).length;

    var st  = 'number' === typeof m.transaction.SourceTag
      ? "?st=" + m.transaction.SourceTag
      : "";

    var dt  = 'number' === typeof m.transaction.DestinationTag
      ? "?dt=" + m.transaction.DestinationTag
      : "";

    var b_gateway_src = !!gateway_addresses[UInt160.json_rewrite(m.transaction.Account)];
    var b_gateway_dst = !!gateway_addresses[UInt160.json_rewrite(m.transaction.Destination)];
    var pay_diff      = b_gateway_src
                          ? +1
                          : b_gateway_dst
                            ? -1
                            : 0;

    var say_amount    = Amount.from_json(m.transaction.Amount).to_human_full(opts_gateways);

    say_type    = 'PAY';
    say_watch   = (pay_diff ? "!" : "")
                    + colorize('console', say_amount, pay_diff)
                    + (pay_diff ? "!" : "")
                    + " "
                    + UInt160.json_rewrite(m.transaction.Account, opts_gateways) + st
                    + " > "
                    + (created ? "!" : "")
                    + UInt160.json_rewrite(m.transaction.Destination, opts_gateways) + dt
                    + (created ? "!" : "");

    say_watch_irc = (pay_diff ? "\u0002" : "")
                    + colorize('irc', say_amount, pay_diff)
                    + (pay_diff ? "\u000f" : "")
                    + " "
                    + UInt160.json_rewrite(m.transaction.Account, opts_gateways) + st
                    + " > "
                    + (created ? "\u0002" : "")
                    + UInt160.json_rewrite(m.transaction.Destination, opts_gateways) + dt
                    + (created ? "\u000f" : "");

    process_offers(m);
  }
  else if (m.transaction.TransactionType === 'AccountSet')
  {
    console.log("transaction: ", JSON.stringify(m, undefined, 2));

    say_type  = 'ACT';
    say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways);
  }
  else if (m.transaction.TransactionType === 'TrustSet')
  {
    var limit = 'LimitAmount' in m.transaction
                  ? Amount.from_json(m.transaction.LimitAmount).to_human_full(opts_gateways) + " "
                  : "";

    say_type  = 'TRS';
    say_watch = limit
                  + UInt160.json_rewrite(m.transaction.Account, opts_gateways);
  }
  else if (m.transaction.TransactionType === 'OfferCreate')
  {
    // console.log("OfferCreate: ", JSON.stringify(m, undefined, 2));

    var owner       = UInt160.json_rewrite(m.transaction.Account, opts_gateways);
    var taker_gets  = Amount.from_json(m.transaction.TakerGets);
    var taker_pays  = Amount.from_json(m.transaction.TakerPays);
    var b_fok       = !!(m.transaction.Flags & Transaction.flags.OfferCreate.FillOrKill);
    var b_ioc       = !!(m.transaction.Flags & Transaction.flags.OfferCreate.ImmediateOrCancel);

    say_type  = b_fok ? 'FOK' : b_ioc ? 'IOC' : 'OFR';
    say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways)
          + " #" + m.transaction.Sequence
          + " offers " + taker_gets.to_human_full(opts_gateways)
          + " for " + taker_pays.to_human_full(opts_gateways);

    if (m.meta.TransactionResult === 'tesSUCCESS'
      && (taker_gets.is_native() || taker_pays.is_native()))
    {
      process_offers(m);

      // Show portion off offer that stuck.
      var what    = taker_gets.is_native()
                      ? 'ASK'
                      : 'BID';

      var created_nodes  = m.meta
                      && m.meta.AffectedNodes.filter(function (node) {
                          return node.CreatedNode && node.CreatedNode.LedgerEntryType === 'Offer';
                        });

      if (created_nodes.length) {
        var created_node  = created_nodes[0];

//console.log("transaction: ", JSON.stringify(m.meta.AffectedNodes, undefined, 2));
//console.log("filtered: ", JSON.stringify(m.meta.AffectedNodes, undefined, 2));
//console.log("CREATED: ", JSON.stringify(created_node, undefined, 2));
        var created_taker_gets = Amount.from_json(created_node.CreatedNode.NewFields.TakerGets);
        var created_taker_pays = Amount.from_json(created_node.CreatedNode.NewFields.TakerPays);

        var xrp     = taker_gets.is_native()
                        ? created_taker_gets
                        : created_taker_pays;
        var amount  = taker_gets.is_native()
                        ? created_taker_pays
                        : created_taker_gets;

        var gateway = gateways[amount.issuer().to_json()];

        if (gateway)
        {
          var line =
                what
                  + " " + gateway
                  + " " + xrp.to_human()
                  + " @ " + xrp.ratio_human(amount).to_human()
                  + " " + amount.currency().to_human()
                  + " " + owner + " #" + m.transaction.Sequence;

          writeMarket(irc.colors.wrap('gray', line), line);
        }
      }
    }
  }
  else if (m.transaction.TransactionType === 'OfferCancel')
  {
    // console.log("transaction: ", JSON.stringify(m, undefined, 2));
// TODO:
//  weex   2000 @ 0.10 BTC Bid WHP #4 Cancel

    say_type  = 'CAN';
    say_watch = UInt160.json_rewrite(m.transaction.Account, opts_gateways)
          + " #" + m.transaction.OfferSequence;
  }

  if (say_watch)
  {
    if (fee != 10)
    {
      say_watch += " [" + fee + "]";

      if (say_watch_irc)
      {
        say_watch_irc += " [" + fee + "]";
      }
    }

    var output_console  =
        (m.engine_result === 'tesSUCCESS'
          ? ""
          : m.engine_result + ": ")
        + say_type + " "
        + say_watch;
      
    var output_irc_base    =
        (m.engine_result === 'tesSUCCESS'
          ? ""
          : m.engine_result + ": ")
        + say_type + " "
        + (say_watch_irc || say_watch);

    var output_irc  =
        m.engine_result === 'tesSUCCESS'
          ? output_irc_base
          : irc.colors.wrap('light_red', output_irc_base);

    writeWatch(output_irc, output_console);
  }
};
 
remote  =
  Remote
    .from_config(remote_config)
    .once('ledger_closed', function (m) {
        self.rippled  = true;

        console.log("*** Connected to rippled");

        if (process.argv.length > 2)
        {
          remote
            .request_tx(process.argv[2])
            .on('success', function (m) {
                // Send transaction as per normal.
                console.log("REPLAY %s", JSON.stringify(m, undefined, 2));

                remote.emit('transaction_all', {
                  transaction: m,
                  meta: m.meta,
                });

                process.exit();
              })
            .request();
        }
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

              // Handle deprecated format.
              if (!('total_coins' in lh.ledger) && 'totalCoins' in lh.ledger)
                lh.ledger.total_coins = lh.ledger.totalCoins;

              if (self.total_coins !== lh.ledger.total_coins) {
                self.total_coins = lh.ledger.total_coins;

                // console.log("ledger_header: ", JSON.stringify(lh, undefined, 2));

                actionWatch("on ledger #" + m.ledger_index + ". Total: " + Amount.from_json(self.total_coins).to_human() + "/XRP");
              }
            })
          .request()

        capital_update(m.ledger_hash);
      })
    .on('transaction_all', process_tx);

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
