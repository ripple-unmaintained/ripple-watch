var irc_config = {
  enable: false,
};

var gateways = {
//  rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B:  'bitstamp',
//  rBcYpuDT1aXNo4jnqczWJTytKGdBGufsre: 'weex', // AUD
//  rpvfJ4mR6QQAeogpXEKnuyGBx8mYCSnYZi: 'weex', // BTC
//  r47RkFi1Ew3LvCNKT6ufw3ZCyj5AJiLHi9: 'weex', // CAD
//  r9vbV3EHvXWjSkeQ6CAcYVPGeq7TuiXY2X: 'weex', // USD
};

var hotwallets = {
//  rrpNnNLKrartuEqfJGpqyDwPj1AFPg9vn1: 'bitstamp',
};

var remote_config = {
    'websocket_ip' : "s1.ripple.com",
    'websocket_port' : 51233,
    'websocket_ssl' : true
};

exports.irc_config	= irc_config;
exports.remote_config	= remote_config;
exports.gateways	= gateways;

// vim:sw=2:sts=2:ts=8:et
