var remote_config = {
  'trusted' : true,
  'websocket_ip' : "127.0.0.1",
  'websocket_port' : 7005,
  'websocket_ssl' : false,
  'local_sequence' : true,
  'local_fee' : true,
};

var irc_config = {
  enable: false,
};

exports.irc_config	= irc_config;
exports.remote_config	= remote_config;

// vim:sw=2:sts=2:ts=8:et
