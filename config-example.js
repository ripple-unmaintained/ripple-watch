var irc_config = {
  enable: false,
};

var gateways = {
};

var remote_config = {
  'trusted' : true,
  'websocket_ip' : "127.0.0.1",
  'websocket_port' : 7005,
  'websocket_ssl' : false,
  'local_sequence' : true,
  'local_fee' : true,
};

exports.irc_config	= irc_config;
exports.remote_config	= remote_config;
exports.gateways	= gateways;

// vim:sw=2:sts=2:ts=8:et
