let protocol;
try {
  protocol = require('../../shared/protocol');
} catch {
  try {
    protocol = require('../shared/protocol');
  } catch {
    protocol = require('./shared/protocol');
  }
}
module.exports = protocol;
