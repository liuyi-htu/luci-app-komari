'use strict';
'require baseclass';
'require form';
'require uci';
'require fs';
'require ui';
'require poll';
'require komari.i18n as komariAgentI18n';
var UI_HELPER = '/usr/libexec/komari-agent-ui';
var SETTINGS_UPLOAD = '/tmp/komari-agent/uploads/settings.json';
var KOMARI_UPLOAD = '/tmp/komari-agent/uploads/komari-agent-upload.tar.gz';
var UPDATE_POLL_INTERVAL = 1000;
var UPDATE_RETRY_INTERVAL = 1000;
function runCommand(args) {
	var helper = ['status', 'read-log', 'update-status'].indexOf(args[0]) >= 0 ? '/usr/libexec/komari-agent-read' : UI_HELPER;
	return fs.exec(helper, args).then(function(res) {
		if (res.code !== 0)
			throw new Error(komariAgentI18n.translate((res.stderr || res.stdout || _('Command failed', 'komari')).trim()));
		return res.stdout || '';
	});
}

function parseStatus(output) {
	var fields = (output || '').trim().split('\t');
	return {
		running: fields[0] === '1',
		enabled: fields[1] === '1',
		version: komariAgentI18n.translate(fields[2]) || _('Not installed', 'komari')
	};
}

function showMessage(message, error) {
	ui.showModal(error ? _('Operation failed', 'komari') : _('Notice', 'komari'), [
		E('p', {}, message),
		E('div', { 'class': 'right' }, [
			E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': function() {
				ui.hideModal();
			} }, _('Close', 'komari'))
		])
	]);
}

function notifyError(err) {
	if (err && err.komariAgentNotified) return;
	showMessage(komariAgentI18n.translate((err && err.message) || String(err)), true);
	if (err && typeof err === 'object') err.komariAgentNotified = true;
}

function notify(message) {
	showMessage(komariAgentI18n.translate(message), false);
}

return baseclass.extend({
 load: function() {
  return Promise.all([uci.load('komari_agent'), L.resolveDefault(runCommand(['status']), '')]);
 },
	updateControls: function() {
		var self = this;
		var busy = this.saving || this.mapSaving || this.serviceBusy || this.updateBusy;
		var blocked = !this.statusKnown || this.running || busy || this.formReadonly;
		document.querySelectorAll('[data-komariAgent-save], #komariAgent-page button:not([data-komariAgent-readonly-action]):not(#komariAgent-service-toggle), .komari-service-block[data-service="agent"] button:not([data-komariAgent-readonly-action]):not(#komariAgent-service-toggle), #komari-log-panel[data-service="agent"] button:not([data-komariAgent-readonly-action]), #komari-update-panel[data-service="agent"] button:not([data-komariAgent-readonly-action])').forEach(function(button) {
			button.disabled = !!blocked || button.dataset.komariAgentBusy === '1' || button.classList.contains('spinning');
			button.title = blocked ? _('Stop Komari Agent before making changes.', 'komari') : '';
		});
		var serviceButton = document.getElementById('komariAgent-service-toggle');
		if (serviceButton) serviceButton.disabled = !!busy || !!self.formReadonly || !self.statusKnown;
        if (this.onControlsChanged) this.onControlsChanged();
	},

	assertStopped: function() {
		return this.refreshStatus().then(function(status) {
			if (status.running) throw new Error(_('Komari Agent is running. Stop the service before saving configuration.', 'komari'));
		});
	},

	saveSettings: function(options) {
		var self = this;
		if (self.saving || self.mapSaving || self.serviceBusy || self.updateBusy) return Promise.resolve();
		self.saving = true;
		self.updateControls();
		return self.assertStopped().then(function() {
			var values = {};
			options.forEach(function(option) {
				var value = option.formvalue('main');
				if ((option.isActive('main') && !option.isValid('main')) || (!option.rmempty && option.isActive('main') && (value == null || value === '')))
					throw new Error(option.title + ': ' + (option.getValidationError('main') || _('This field is required.', 'komari')));
				values[option.option] = option.isActive('main') ? (value == null ? '' : String(value)) : '';
			});
			return fs.write(SETTINGS_UPLOAD, JSON.stringify(values), 384);
		}).then(function() {
			return runCommand([ 'save-settings' ]);
		}).then(function(message) {
			notify(message.trim() || _('Configuration saved.', 'komari'));
			uci.unload('komari_agent'); return uci.load('komari_agent').then(function() { return self.refreshStatus(); });
		}).catch(notifyError).finally(function() {
			self.saving = false;
			self.updateControls();
		});
	},

	refreshStatus: function() {
		var self = this;
		return runCommand([ 'status' ]).then(function(output) {
			if (!/^[01]\t[01]\t/.test(output)) throw new Error(_('Unable to read Komari Agent service status.', 'komari'));
			var status = parseStatus(output);
			self.running = status.running;
			self.statusKnown = true;
			self.updateControls();
			var running = document.getElementById('komariAgent-running-status');
			var enabled = document.getElementById('komariAgent-enabled-status');
			var version = document.getElementById('komariAgent-version-status');
			var serviceButton = document.getElementById('komariAgent-service-toggle');
			var enableButton = document.getElementById('komariAgent-enable-toggle');

			if (running) {
				running.textContent = status.running ? _('Running', 'komari') : _('Stopped', 'komari');
				running.className = status.running ? 'komariAgent-ok' : 'komariAgent-bad';
			}
			if (enabled) {
				enabled.textContent = status.enabled ? _('Enabled', 'komari') : _('Disabled', 'komari');
				enabled.className = status.enabled ? 'komariAgent-ok' : 'komariAgent-bad';
			}
			if (version) version.textContent = status.version;
			if (serviceButton) {
				serviceButton.dataset.running = status.running ? '1' : '0';
				serviceButton.textContent = status.running ? _('Stop service', 'komari') : _('Start service', 'komari');
				serviceButton.className = status.running ? 'btn cbi-button-negative' : 'btn cbi-button-action important';
			}
			if (enableButton) {
				enableButton.dataset.enabled = status.enabled ? '1' : '0';
				enableButton.textContent = status.enabled ? _('Disable autostart', 'komari') : _('Enable autostart', 'komari');
			}
			if (self.onStatusChanged) self.onStatusChanged(status);
			return status;
		}).catch(function(err) {
			self.statusKnown = false;
			self.updateControls();
			throw err;
		});
	},

	renderStatusBar: function(initialStatus) {
		var self = this;
		var serviceButton = E('button', {
			'type': 'button',
			'class': initialStatus.running ? 'btn cbi-button-negative' : 'btn cbi-button-action important',
			'id': 'komariAgent-service-toggle',
			'data-running': initialStatus.running ? '1' : '0',
			'click': function(ev) {
				var button = ev.currentTarget;
				if (self.saving || self.mapSaving || self.serviceBusy || self.updateBusy) return;
				self.serviceBusy = true;
				self.updateControls();
				var action = button.dataset.running === '1' ? 'stop' : 'start';
				button.disabled = true;
				return runCommand([ 'service', action ]).then(function() {
					notify(action === 'start' ? _('Komari Agent started.', 'komari') : _('Komari Agent stopped.', 'komari'));
					return self.refreshStatus();
				}).catch(notifyError).finally(function() {
					self.serviceBusy = false;
					self.updateControls();
					self.updateControls();
				});
			}
		}, initialStatus.running ? _('Stop service', 'komari') : _('Start service', 'komari'));

		var enableButton = E('button', {
			'type': 'button',
			'class': 'btn cbi-button-apply',
			'id': 'komariAgent-enable-toggle',
			'data-enabled': initialStatus.enabled ? '1' : '0',
			'click': function(ev) {
				var button = ev.currentTarget;
				if (button.disabled) return;
				button.dataset.komariAgentBusy = '1';
				var action = button.dataset.enabled === '1' ? 'disable' : 'enable';
				button.disabled = true;
				return runCommand([ 'service', action ]).then(function() {
					notify(action === 'enable' ? _('Autostart enabled.', 'komari') : _('Autostart disabled.', 'komari'));
					return self.refreshStatus();
				}).catch(notifyError).finally(function() {
					button.dataset.komariAgentBusy = '0';
					self.updateControls();
				});
			}
		}, initialStatus.enabled ? _('Disable autostart', 'komari') : _('Enable autostart', 'komari'));

		return E('div', { 'class': 'komariAgent-status-scroll' }, [
			E('div', { 'class': 'komariAgent-status-row' }, [
				E('span', {}, [ _('Service status', 'komari') + ': ', E('strong', {
					'id': 'komariAgent-running-status',
					'class': initialStatus.running ? 'komariAgent-ok' : 'komariAgent-bad'
				}, initialStatus.running ? _('Running', 'komari') : _('Stopped', 'komari')) ]),
				E('span', {}, [ _('Autostart', 'komari') + ': ', E('strong', {
					'id': 'komariAgent-enabled-status',
					'class': initialStatus.enabled ? 'komariAgent-ok' : 'komariAgent-bad'
				}, initialStatus.enabled ? _('Enabled', 'komari') : _('Disabled', 'komari')) ]),
				E('strong', { 'class': 'komari-service-role' }, _('Agent', 'komari')),
				E('span', {}, [ _('Version', 'komari') + ': ', E('strong', { 'id': 'komariAgent-version-status' }, initialStatus.version) ]),

				serviceButton,
				enableButton
			])
		]);
	},

	renderLogs: function() {
		var kind = E('select', {
			'id': 'komariAgent-log-kind',
			'class': 'cbi-input-select',
			'change': function() { return refresh().catch(notifyError); }
		}, [
			E('option', { 'value': 'komari-agent' }, 'agent.log'),
			E('option', { 'value': 'update' }, 'agent-update.log')
		]);
		var output = E('pre', { 'id': 'komariAgent-log-output', 'class': 'komariAgent-log' }, _('Click Refresh log to read the log.', 'komari'));

		function refresh() {
			return runCommand([ 'read-log', kind.value ]).then(function(content) {
				var normalized = komariAgentI18n.logText(content || '').replace(/\n$/, '');
				var lines = normalized ? normalized.split('\n').slice(-50) : [];
				output.textContent = lines.length ? lines.join('\n') : _('No log entries.', 'komari');
				output.scrollTop = output.scrollHeight;
			});
		}
		this.refreshLogs = refresh;

		return E('div', {}, [
			E('div', { 'class': 'komariAgent-actions' }, [
				kind,
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-action', 'data-komariAgent-readonly-action': '1',
					'click': function() { return refresh().catch(notifyError); }
				}, _('Refresh log', 'komari')),
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-negative',
					'click': function() {
						var selectedKind = kind.value;
						if (!confirm(_('Clear the selected log?', 'komari'))) return;
						return runCommand([ 'clear-log', selectedKind ]).then(function() {
							if (kind.value === selectedKind) output.textContent = _('No log entries.', 'komari');
							notify(_('Log cleared.', 'komari'));
						}).catch(notifyError);
					}
				}, _('Clear log', 'komari'))
			]),
			output
		]);
	},

	renderUpdate: function() {
		var self = this;
		var progressFill = E('div', { 'class': 'komariAgent-update-progress-fill' });
		var progress = E('div', {
			'id': 'komariAgent-update-progress',
			'class': 'komariAgent-update-progress',
			'role': 'progressbar',
			'aria-valuemin': '0',
			'aria-valuemax': '100',
			'aria-valuenow': '0'
		}, [ progressFill ]);
		var progressText = E('span', { 'id': 'komariAgent-update-progress-text' }, _('No update has started.', 'komari'));
		var onlineButton;
		var uploadButton;

		function setUpdateBusy(busy) {
            self.updateBusy = busy;
			[ onlineButton, uploadButton ].forEach(function(button) {
				if (button) button.dataset.komariAgentBusy = busy ? '1' : '0';
			});
			self.updateControls();
		}

		function parseUpdateStatus(output) {
			var fields = (output || '').trim().split('\t');
			var percent = Number(fields[1]);
			return {
				state: fields[0] || 'idle',
				percent: isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
				message: komariAgentI18n.translate(fields.slice(2).join('\t')) || _('No update has started.', 'komari')
			};
		}

		function scheduleProgressRefresh(delay) {
			window.clearTimeout(self.updateProgressTimer);
			self.updateProgressTimer = window.setTimeout(function() {
				refreshProgress();
			}, delay);
		}

		function refreshProgress() {
			window.clearTimeout(self.updateProgressTimer);
			return runCommand([ 'update-status' ]).then(function(output) {
				var status = parseUpdateStatus(output);
				progressFill.style.width = status.percent + '%';
				progress.setAttribute('aria-valuenow', String(status.percent));
				progressText.textContent = '%d%% · %s'.format(status.percent, status.message);
				progressText.className = status.state === 'error' ? 'komariAgent-bad' :
					(status.state === 'success' ? 'komariAgent-ok' : '');
				setUpdateBusy(status.state === 'running');

				if (status.state === 'running') {
					self.updateProgressPolling = true;
					scheduleProgressRefresh(UPDATE_POLL_INTERVAL);
				}
				else {
					self.updateProgressPolling = false;
					if (status.state === 'success')
						self.refreshStatus().catch(notifyError);
				}
				return status;
			}).catch(function(err) {
				if (!self.updateProgressPolling)
					throw err;
				progressText.className = '';
				progressText.textContent = _('Reading update status again...', 'komari');
				scheduleProgressRefresh(UPDATE_RETRY_INTERVAL);
				return null;
			});
		}

		function handleUpdateStartError(err, button) {
			var message = (err && err.message) || String(err);
			if (/timed?\s*out|timeout/i.test(message)) {
				return L.resolveDefault(refreshProgress(), null).then(function(status) {
					if (status && status.state !== 'idle') return;
					self.updateProgressPolling = false;
					setUpdateBusy(false);
					notifyError(err);
				});
			}
			self.updateProgressPolling = false;
			setUpdateBusy(false);
			notifyError(err);
		}
		this.refreshUpdateProgress = refreshProgress;

		onlineButton = E('button', {
			'type': 'button', 'class': 'btn cbi-button-apply important',
			'click': function(ev) {
				var button = ev.currentTarget;
				if (!confirm(_('Check for online updates?', 'komari'))) return;
				if (button.disabled) return;
				setUpdateBusy(true);
				self.updateProgressPolling = true;
				progressFill.style.width = '1%';
				progress.setAttribute('aria-valuenow', '1');
				progressText.className = '';
				progressText.textContent = _('Starting online update...', 'komari');
				scheduleProgressRefresh(UPDATE_POLL_INTERVAL);
				return self.assertStopped().then(function() { return runCommand([ 'update-online' ]); }).then(function(message) {
					notify(message.trim());
					return refreshProgress();
				}).catch(function(err) { return handleUpdateStartError(err, button); });
			}
		}, _('Online update', 'komari'));

		uploadButton = E('button', {
			'type': 'button', 'class': 'btn cbi-button-action',
			'click': function(ev) {
				var button = ev.currentTarget;
				if (button.disabled) return;
				setUpdateBusy(true);
				return self.assertStopped().then(function() { return ui.uploadFile(KOMARI_UPLOAD); }).then(function(reply) {
					if (reply.size > 128 * 1024 * 1024) {
						return fs.remove(KOMARI_UPLOAD).then(function() {
							throw new Error(_('The uploaded file must not exceed 128 MiB.', 'komari'));
						});
					}
					self.updateProgressPolling = true;
					scheduleProgressRefresh(UPDATE_POLL_INTERVAL);
					return runCommand([ 'update-local' ]);
				}).then(function(message) {
					notify(message.trim());
					return refreshProgress();
				}).catch(function(err) {
					if (/cancel/i.test((err && err.message) || '')) {
						self.updateProgressPolling = false;
						setUpdateBusy(false);
						return;
					}
					return handleUpdateStartError(err, button);
				});
			}
		}, _('Upload Komari Agent or tar.gz', 'komari'));

		return E('div', {}, [
			E('div', { 'class': 'komariAgent-update-status' }, [ progress, progressText ]),
			E('div', { 'class': 'komariAgent-actions' }, [
				onlineButton,
				uploadButton
			])
		]);
	},


 render: function(data) {
  var self = this, initialStatus = parseStatus(data[1]);
  self.running = initialStatus.running;
  self.statusKnown = /^[01]\t[01]\t/.test(data[1] || '');
  var m = new form.Map('komari_agent'), options = [];
  m.readonly = !L.hasViewPermission();
  var s = m.section(form.NamedSection, 'main', 'agent');
  s.addremove = false;
  var o = s.option( form.Value, 'endpoint', _('Panel URL', 'komari'));
  o.placeholder = 'http://127.0.0.1:25774'; o.rmempty = false;
  o.validate = function(sectionId, value) { return /^https?:\/\/[^\s@]+$/.test(value || '') || _('Panel URL must start with http:// or https://', 'komari'); };
  options.push(o);
  o = s.option( form.Value, 'token', _('Agent token', 'komari'));
  o.password = true; o.rmempty = false;
  o.validate = function(sectionId, value) { return /^[A-Za-z0-9._-]+$/.test(value || '') || _('Agent token is required and must contain only letters, digits, dots, underscores or hyphens', 'komari'); };
  options.push(o);
  o = s.option( form.Value, 'interval', _('Collection interval (seconds)', 'komari'));
  o.default = '3'; o.datatype = 'range(1,3600)'; o.rmempty = false; options.push(o);
  o = s.option( form.Flag, 'disable_web_ssh', _('Disable remote control', 'komari'));
  o.default = '1'; o.rmempty = false; options.push(o);
  o = s.option( form.Flag, 'ignore_unsafe_cert', _('Ignore unsafe TLS certificates', 'komari'));
  o.default = '0'; o.rmempty = false; options.push(o);
  o = s.option(form.Flag, 'memory_include_cache', _('Include cached and buffered memory', 'komari'));
  o.default = '0'; o.rmempty = false; options.push(o);
  o = s.option(form.Flag, 'get_ip_addr_from_nic', _('Get IP address from network interfaces', 'komari'));
  o.default = '0'; o.rmempty = false; options.push(o);
  o = s.option(form.Value, 'month_rotate', _('Monthly network reset day', 'komari'), _('Use 0 to disable monthly reset, or 1-31 for the day of the month.', 'komari'));
  o.default = '0'; o.datatype = 'range(0,31)'; o.rmempty = false; options.push(o);
  [['include_nics','Include network interfaces'], ['exclude_nics','Exclude network interfaces'], ['include_mountpoints','Include mount points']].forEach(function(field) {
   o = s.option( form.Value, field[0], _(field[1], 'komari'));
   o.rmempty = true; options.push(o);
  });
  o = s.option( form.DummyValue, '_save');
  o.render = function() {
   return E('div', {'class':'komariAgent-actions'}, [E('button', {
    'type':'button', 'class':'btn cbi-button-positive', 'data-komariAgent-save':'settings',
    'click':function() { return self.saveSettings(options); }
   }, _('Save configuration', 'komari'))]);
  };
  return m.render().then(function(rendered) {
   self.formReadonly = m.readonly;
   ['logs','update'].forEach(function(name) {
    var pane = rendered.querySelector('[data-tab="'+name+'"][data-tab-title]');
    if (pane) pane.addEventListener('cbi-tab-active', function() {
     var refresh = name === 'logs' ? self.refreshLogs : self.refreshUpdateProgress;
     if (refresh) refresh().catch(notifyError);
    });
   });
   poll.add(function() { return self.refreshStatus().catch(function() {}); }, 3);
   window.requestAnimationFrame(function() { self.updateControls(); });
   self.statusBlock = E('div', { 'class': 'komari-service-block', 'data-service': 'agent' }, [self.renderStatusBar(initialStatus)]);
   self.statusFooter = E('div', { 'class': 'komari-service-footer' }, self.statusBlock);
   return E('div', {'id':'komariAgent-page'}, [
    E('style', {}, '.komariAgent-status-scroll{max-width:100%;overflow-x:auto;margin:1em 0;scrollbar-width:none}.komariAgent-status-scroll::-webkit-scrollbar{display:none}.komariAgent-status-row{display:flex;align-items:center;gap:1em;flex-wrap:nowrap;width:max-content;min-width:100%;white-space:nowrap}.komariAgent-status-row>*{flex-shrink:0}.komariAgent-actions{display:flex;gap:.6em;align-items:center;flex-wrap:wrap;margin:1em 0}.komariAgent-ok{color:#2e7d32}.komariAgent-bad{color:#d32f2f}.komariAgent-log{max-height:55vh;min-height:18em;overflow:auto;white-space:pre-wrap;word-break:break-all;padding:1em;border:1px solid #ddd;scrollbar-width:none}.komariAgent-log::-webkit-scrollbar{display:none}.komariAgent-update-status{display:flex;gap:.8em;align-items:center;flex-wrap:wrap;margin:1em 0}.komariAgent-update-progress{width:min(34em,100%);height:1.2em;overflow:hidden;border:1px solid #bbb;border-radius:.35em}.komariAgent-update-progress-fill{width:0;height:100%;background:#1677ff;transition:width .3s ease}'),
    self.statusFooter,
    rendered
   ]);
  });
 },
 handleSave: null,
 handleSaveApply: null,
 handleReset: null
});
