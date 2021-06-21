/* global fetch, chrome, decrypt */
var browser = browser || chrome

const SERVERS = [
	{ url: 'https://cr-unblocker.us.to/start_session?version=1.1', sendUserId: true }
]

/**
 * Resets the timer, e.g. when on the login page
 */
function resetLastUnblock() {
	console.log('removing timer')
	localStorage.removeItem('last_unblock')
}

/**
 * Main function fetching and setting the US based cookies
 * @param {String}  subdomain subdomain, if applicable
 * @param {String}  extension extension of domain
 * @param {boolean} loggedIn  login status of user
 */
function localizeToUs(subdomain = "", extension) {
	var lastUnblock = localStorage.getItem('last_unblock')

	if (lastUnblock && lastUnblock > new Date().getTime()) {
		console.log('Not fetching session id, last try less than a minute ago.')
		console.log(`Remaining: ${((lastUnblock - new Date().getTime()) / 1000)} seconds`)
		return
	}

	console.log('Fetching session id.')
	SERVERS.shuffle()
	let settings = this.settings.get()
	browser.storage.local.get({ login: null, user: null }, (item) => {
		var auth = ''
		if (settings.saveLogin && item.login !== null) {
			console.log('Logging in using auth token.')
			auth = `&auth=${encodeURIComponent(item.login.auth)}`
		}
		try {
			sequentialFetch(SERVERS, subdomain, extension, auth, item.user)
		} finally {
			localStorage.setItem('last_unblock', new Date(new Date().getTime() + (60 * 1000)).getTime())
		}
	});
}

/**
 * Fetch in order an array of servers URLs
 * @param {Array}  servers   Servers to fetch in order
 * @param {String} subdomain subdomain, if applicable
 * @param {String} extension Extension of the current domain
 * @param {String} auth      Auth token to login user
 * @param {Object} user      User data for the user to log in
 */
function sequentialFetch(servers, subdomain = "", extension, auth, user) {
	console.log(`Fetching server ${servers[0].url}`)
	fetchServer(servers[0], auth, user)
		.then(sessionData => updateCookies(subdomain, extension, sessionData))
		.catch(e => {
			console.log(e);
			if (servers.slice(1).length > 0) {
				sequentialFetch(servers.slice(1), subdomain, extension, auth, user)
			} else {
				notifyUser(`CR-Unblocker couldn't get a session id. Delaying retry for a minute ...`)
			}
		})
}

/**
 * Fetch a session ID from a server
 * @param  {Object} server Object describing backend server to use
 * @param  {String} auth      Auth token to login user
 * @param  {Object} user User data for the user to log in
 * @return {Promise}     A promise resolving to the the session data containing session id and possibly user/auth data
 */
function fetchServer(server, auth, user) {
	return new Promise((resolve, reject) => {
		let uri = server.url + auth
		if (server.sendUserId && user !== null && user.userId !== null && auth !== '') {
			console.log('sendUserId')
			uri += `&user_id=${encodeURIComponent(user.userId)}`
		}
		if (server.generateDeviceId) {
			uri += `&device_id=${generateDeviceId()}`
		}
		fetch(uri)
			.then(res => {
				if (res.ok) {
					return res.json()
				}
				reject(new Error(res.status))
			})
			.then(json => {
				if (json.error === true) {
					reject(new Error(json.message))
				} else if (json.data.country_code !== 'US') {
					reject(new Error('Session id not from the US'))
				} else {
					resolve(json.data)
				}
			})
			.catch((e) => reject(e))
	});
}

/**
 * Update the cookies to the new values
 * Nested callbacks for Edge compatibility
 * @param {String} subdomain subdomain, if applicable
 * @param {String} extension hostname extension
 * @param {Object} sessionData  New session data
 */
function updateCookies(subdomain = "", extension, sessionData) {
	console.log(`got session id. Setting cookie ${sessionData.session_id}.`)
	browser.cookies.set({
		url: `https://${subdomain}crunchyroll${extension}`,
		name: 'session_id',
		value: sessionData.session_id,
		domain: `${subdomain}crunchyroll${extension}` //,
		//httpOnly: true
	}, () => {
		browser.cookies.set({
			url: `https://${subdomain}crunchyroll${extension}`,
			name: 'c_locale',
			value: 'enUS',
			domain: `${subdomain}crunchyroll${extension}` //,
			//httpOnly: true
		}, () => {
			browser.cookies.set({
				url: `https://${subdomain}crunchyroll${extension}`,
				name: 'OptanonConsent',
				value: (await browser.cookies.get({ name: "OptanonConsent" })).value.replace(/(?<=&geolocation=)[a-zA-Z-_]{1,5}(?=%3[bB])/, sessionData.country_code),
				domain: `${subdomain}crunchyroll${extension}` //,
				//httpOnly: true
			}, () => {
				browser.cookies.set({
					url: `https://${subdomain}crunchyroll${extension}`,
					name: 'OptanonControl',
					value: (await browser.cookies.get({ name: "OptanonControl" })).value.replace(/(?<=ccc=)[a-zA-Z-_]{1,5}/, sessionData.country_code),
					domain: `${subdomain}crunchyroll${extension}` //,
					//httpOnly: true
				}, () => doLogin(sessionData));
			});
		});
	});
}

/**
 * Logs in a user using the given login data
 * @param {String} sessionId current session id
 * @param {Object} loginData login data (properties username and password are needed)
 * @return {Promise} A promise resolving to the login data (contains user data, auth and expiration)
 */
function loginUser(sessionId, loginData) {
	return new Promise((resolve, reject) => {
		if (typeof loginData.password === 'string') {
			// if the password is decrypted, login using the API
			fetch(`https://api.crunchyroll.com/login.0.json?session_id=${sessionId}&locale=enUS&account=${encodeURIComponent(loginData.username)}&password=${encodeURIComponent(loginData.password)}`, { method: 'POST' })
				.then((res) => res.json())
				.then((res) => {
					if (res.error === true) {
						reject(new Error(res.message))
					} else {
						resolve(res.data)
					}
				})
				.catch((e) => reject(e))
		} else {
			// password isn't in plain text, decrypt it
			decrypt(loginData.username, loginData.password)
				.then(password => {
					loginUser(sessionId, { username: loginData.username, password: password })
						.then(data => resolve(data))
						.catch(_e => reject(_e))
				})
				.catch(_e => reject(_e))
		}
	});
}

/**
 * Function called after the cookies are set
 * Login user if needed
 * @param {Object} sessionData current session data
 */
function doLogin(sessionData) {
	let settings = this.settings.get()
	browser.storage.local.get({ loginData: null }, (item) => {
		if (sessionData.user === null && settings.saveLogin && item.loginData !== null) {
			// login data stored, log the user in
			console.log('Logging in using username/password')
			if (typeof item.loginData.password === 'string') {
				// delete password if stored unencrypted (auth token will be stored)
				browser.storage.local.remove(['loginData'])
			}
			loginUser(sessionData.session_id, item.loginData)
				.then((data) => {
					console.log(`User logged in until ${data.expires}`);
					// store auth, expiration and userId, then reload
					browser.storage.local.set({ login: { auth: data.auth, expiration: data.expires }, user: { userId: data.user.user_id } }, reloadTab)
				})
				.catch((_e) => {
					notifyUser('Failed to login, please log in manually.')
					console.log(_e)
					reloadTab()
				});
		} else if (sessionData.user !== null && settings.saveLogin) {
			// user was already logged in when starting the session, store the new auth and expiration
			console.log(`Logged in until ${sessionData.expires}`)
			browser.storage.local.set({ login: { auth: sessionData.auth, expiration: sessionData.expires } }, reloadTab)
		} else {
			// no need to login, reload immediately
			reloadTab()
		}
	})
}

/**
 * Function called after the user is logged in (if they want to)
 * Reload the current tab to take the changes into account
 */
function reloadTab() {
	console.log('Done!')
	browser.tabs.query({
		currentWindow: true,
		active: true
	}, tabs => {
		tabs.forEach(tab => {
			console.log('Reload tab via content script')
			browser.tabs.sendMessage(tab.id, { action: 'reload' })
		})
	})
}

/**
 * Emit a notification to the user with an error message
 * @param  {String} msg Error message
 */
function notifyUser(msg) {
	browser.notifications.create({
		type: 'basic',
		iconUrl: 'icons/Crunchyroll-128.png',
		title: 'CR-Unblocker has encountered an error',
		message: msg
	})
}

/**
 *  Add content script listener
 */
browser.runtime.onMessage.addListener((message) => {
	switch (message.action) {
		case 'localizeToUs':
			localizeToUs(message.subdomain, message.extension, message.loggedIn)
			break
		case 'resetLastUnblock':
			resetLastUnblock()
			break
	}
})

/**
 *  Open the changelog page after update or installation
 */
browser.runtime.onInstalled.addListener((detail) => {
	if (detail.reason === 'install' || detail.reason === 'update') {
		browser.tabs.create({ url: 'https://cr-unblocker.us.to' })
	}
})

/**
 * Add a method to shuffle arrays randomly
 */
Array.prototype.shuffle = function shuffle() {
	var swapIndex, tempElement
	for (var i = this.length; i; i--) {
		swapIndex = Math.floor(Math.random() * i)
		tempElement = this[i - 1]
		this[i - 1] = this[swapIndex]
		this[swapIndex] = tempElement
	}
}

/**
 * Generate a random 32 character long device ID
 * @return {String} Generated device ID
 */
function generateDeviceId() {
	let id = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	for (var i = 0; i < 32; i++) {
		id += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return id
}
