'use strict';
'require view';
'require ui';
'require fs';
'require komari.i18n as komariI18n';
'require komari.server as serverWidget';
'require komari.agent as agentWidget';

return view.extend({
 load: function() {
  return Promise.all([serverWidget.load(), agentWidget.load()]);
 },
 render: function(data) {
  var self = this;
  var lastService = 'agent';
  return Promise.all([serverWidget.render(data[0]), agentWidget.render(data[1])]).then(function(nodes) {
   var serverPane = E('div', {
    'data-tab': 'server', 'data-tab-title': _('Server', 'komari')
   }, nodes[0]);
   var agentPane = E('div', {
    'data-tab': 'agent', 'data-tab-title': _('Agent', 'komari'), 'data-tab-active': 'true'
   }, nodes[1]);

   function managementPane(kind, title) {
    var selection = E('select', {
     'id': 'komari-' + kind + '-service', 'class': 'cbi-input-select'
    }, [E('option', { 'value': 'agent' }, _('Agent', 'komari')), E('option', { 'value': 'server' }, _('Server', 'komari'))]);
    var body = E('div');
    var panel = E('div', { 'id': 'komari-' + kind + '-panel', 'data-service': 'agent' }, [
     E('div', { 'class': 'komari-management-target' }, [E('label', {
      'for': 'komari-' + kind + '-service'
     }, _('Service', 'komari')), ' ', selection]), body
    ]);
    var pane = E('div', { 'data-tab': kind, 'data-tab-title': title }, panel);
    var initialized = false;
    function refresh() {
     var widget = selection.value === 'agent' ? agentWidget : serverWidget;
     var action = kind === 'log' ? widget.refreshLogs : widget.refreshUpdateProgress;
     widget.updateControls();
     if (action) return action().catch(function(error) { ui.addNotification(null, E('p', {}, error.message), 'error'); });
    }
    function render() {
     var widget = selection.value === 'agent' ? agentWidget : serverWidget;
     panel.setAttribute('data-service', selection.value);
     body.replaceChildren(kind === 'log' ? widget.renderLogs() : widget.renderUpdate());
     initialized = true;
     return refresh();
    }
    selection.addEventListener('change', render);
    pane.addEventListener('cbi-tab-active', function() {
     if (!selection.disabled && selection.value !== lastService) {
      selection.value = lastService;
      return render();
     }
     return initialized ? refresh() : render();
    });
    return pane;
   }
   var logFiles = {
    'server.log': ['server', 'komari'],
    'agent.log': ['agent', 'komari-agent'],
    'server-update.log': ['server', 'update'],
    'agent-update.log': ['agent', 'update']
   };
   var logSelection = E('select', { 'class': 'cbi-input-select', 'id': 'komari-log-file' }, Object.keys(logFiles).map(function(name) {
    return E('option', { 'value': name }, name);
   }));
   var output = E('pre', { 'class': 'komari-log' }, _('No log entries.', 'komari'));
   var logPanel = E('div', { 'id': 'komari-log-panel', 'data-service': 'server' });
   var logRequest = 0;
   var logOpened = false;
   function logCommand(command, name) {
    var target = logFiles[name];
    var helper = target[0] === 'agent' ? '/usr/libexec/komari-agent-' : '/usr/libexec/komari-';
    return fs.exec(helper + (command === 'read-log' ? 'read' : 'ui'), [command, target[1]]).then(function(result) {
     if (result.code !== 0) throw new Error(komariI18n.translate((result.stderr || result.stdout || _('Command failed', 'komari')).trim()));
     return result.stdout || '';
    });
   }
   function refreshLog() {
    if (!logOpened) return Promise.resolve();
    var name = logSelection.value, request = ++logRequest;
    logPanel.setAttribute('data-service', logFiles[name][0]);
    (logFiles[name][0] === 'agent' ? agentWidget : serverWidget).updateControls();
    return logCommand('read-log', name).then(function(text) {
     if (request !== logRequest || name !== logSelection.value) return;
     output.textContent = text ? komariI18n.logText(text).replace(/\n$/, '') : _('No log entries.', 'komari');
     output.scrollTop = output.scrollHeight;
    }).catch(function(error) { ui.addNotification(null, E('p', {}, error.message), 'error'); });
   }
   logSelection.addEventListener('change', refreshLog);
   logPanel.appendChild(E('div', { 'class': 'komari-actions' }, [logSelection,
    E('button', {
     'type': 'button', 'class': 'btn cbi-button-action', 'data-komari-readonly-action': '1', 'data-komariAgent-readonly-action': '1',
     'click': refreshLog
    }, _('Refresh log', 'komari')),
    E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
     var name = logSelection.value;
     if (!confirm(_('Clear the selected log?', 'komari'))) return;
     return logCommand('clear-log', name).then(refreshLog).catch(function(error) { ui.addNotification(null, E('p', {}, error.message), 'error'); });
    } }, _('Clear log', 'komari'))
   ]));
   logPanel.appendChild(output);
   var logPane = E('div', { 'data-tab': 'log', 'data-tab-title': _('Logs', 'komari') }, logPanel);
   var updatePane = managementPane('update', _('Update core', 'komari'));
   var group = E('div', { 'class': 'komari-services' }, [agentPane, serverPane, logPane, updatePane]);
   var runningServices = E('div', { 'id': 'komari-running-services' });
   var page = E('div', { 'id': 'komari-unified-page' }, [
    E('h2', {}, 'Komari'), runningServices,
    E('style', {}, '#komari-unified-page>.cbi-tabmenu{margin-bottom:6px}.komari-service-footer{display:flow-root}.komari-service-footer:empty{display:none}.komari-service-footer .komari-status-scroll,.komari-service-footer .komariAgent-status-scroll{margin:0;padding:0 0 .5em}.komari-management-target{display:flex;align-items:center;gap:.6em;margin:1em 0}'), group
   ]);
   function placeStatus(widget) {
    var target = widget.running ? runningServices : widget.statusFooter;
    if (widget.statusBlock.parentNode !== target) target.appendChild(widget.statusBlock);
   }
   serverWidget.onStatusChanged = function() { placeStatus(serverWidget); };
   agentWidget.onStatusChanged = function() { placeStatus(agentWidget); };
   placeStatus(agentWidget); placeStatus(serverWidget);
   serverWidget.onControlsChanged = agentWidget.onControlsChanged = function() {
    var selection = document.getElementById('komari-update-service');
    if (selection) selection.disabled = !!serverWidget.updateBusy || !!agentWidget.updateBusy;
   };
   serverPane.addEventListener('cbi-tab-active', function() {
    lastService = 'server'; serverWidget.refreshStatus().catch(function() {});
   });
   agentPane.addEventListener('cbi-tab-active', function() {
    lastService = 'agent'; agentWidget.refreshStatus().catch(function() {});
   });
   ui.tabs.initTabGroup([agentPane, serverPane, logPane, updatePane]);
   page.querySelector('.cbi-tabmenu [data-tab="log"] a').addEventListener('click', function() {
    logOpened = true;
    return refreshLog();
   });
   return page;
  });
 },
 handleSave: null,
 handleSaveApply: null,
 handleReset: null
});
