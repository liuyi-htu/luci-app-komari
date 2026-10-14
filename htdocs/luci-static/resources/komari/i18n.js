'use strict';
'require baseclass';

var patterns = [
 [ '^Komari Agent updated to (.+)\\.$', 'Komari Agent updated to %s.' ],
 [ '^Update failed: (.+)$', 'Update failed: %s' ],
 [ '^Komari updated to (.+)\\.$', 'Komari updated to %s.' ]
];
function translate(message, depth) {
 var text = String(message == null ? '' : message);
 var direct = _(text, 'komari');
 if (direct !== text || (depth || 0) > 8) return direct;
 for (var i = 0; i < patterns.length; i++) {
  var match = new RegExp(patterns[i][0]).exec(text);
  if (!match) continue;
  var template = _(patterns[i][1], 'komari');
  if (template === patterns[i][1]) return text;
  var argument = 0;
  return template.replace(/%s/g, function() { return translate(match[++argument], (depth || 0) + 1); });
 }
 return text;
}
function logText(text) {
 return String(text).split('\n').map(function(line) {
  var match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} )(.*)$/.exec(line);
  if (match) return match[1] + translate(match[2]);
  var syslog = /^(.* komari-(?:server-update|agent-update)(?:\[[0-9]+\])?: )(.*)$/.exec(line);
  return syslog ? syslog[1] + translate(syslog[2]) : translate(line);
 }).join('\n');
}
return baseclass.extend({ translate: translate, logText: logText });
