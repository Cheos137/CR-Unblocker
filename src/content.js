/* global chrome, window, document, encrypt */
var browser = browser || chrome;

/**
 * Check if the current CR page is located in the US
 * @return {Boolean} true if currently in the US
 */
function isUs() {
	/* old function body:
	let usRegExp = new RegExp('United States of America');
	let location = document.getElementById('footer_country_flag');
	return !!usRegExp.test(location.alt);
	*/

	// new method body (principle) by @sabarnac (https://github.com/sabarnac)
	if (sessionStorage._ucWMConf)
		return JSON.parse(sessionStorage._ucWMConf).contryCode === "US";

	return (Object.keys(sessionStorage)
		.map((key) => sessionStorage[key])
		.map((data) => {
			try { return JSON.parse(data); } catch (e) { return null; }
		})
		.filter((data) => data !== null)
		.find((data) => "countryCode" in data)?.countryCode === "US");
}

/**
 * Check if we're currently on the login page
 * @return {Boolean} true if currently on the login page
 */
function isLoginPage() {
	return window.location.pathname.startsWith('/login');
}

/**
 * Check if the user is logged in
 */
function isLoggedIn() {
	return document.querySelectorAll('[token="login_top"]').length === 0;
}

/**
* Listen for messages and reload the page when asked by the background script
*/
browser.runtime.onMessage.addListener((message) => {
	if (message.action === 'reload') {
		console.log('Reloading to apply new cookies');
		location.reload(true);
	}
});

/**
 * This function is called everytime the user visit a crunchyroll page
 * It will ask the background script to get a new cookie if it is not located
 * in the US
 */
browser.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
	if (isLoginPage()) {
		browser.runtime.sendMessage({ action: 'resetLastUnblock' });
		if (settings.saveLogin) {
			// login data should be saved --> add event handler to form submit that stores username and password in local storage
			document.querySelector('#login_form').addEventListener('submit', () => {
				let username = document.querySelector('#login_form_name').value;
				let password = document.querySelector('#login_form_password').value;
				encrypt(username, password)
					.then(encrypted => {
						browser.storage.local.set({
							loginData: {
								username: username,
								password: encrypted
							}
						});
					})
					.catch(() => {
						browser.storage.local.set({
							loginData: {
								username: username,
								password: password
							}
						});
					});
			});
		}
	} else if (/*document.getElementById('footer_country_flag') &&*/ !isUs()) { // Cheos: there is no country flag anymore
		if (settings.switchRegion) {
			let hostname = window.location.hostname;
			browser.runtime.sendMessage({
				action: 'localizeToUs',
				subdomain: hostname.slice(hostname.search(/^https:\/\//) != -1 ? 8 : 7, hostname.indexOf('crunchyroll.'), // Cheos: supply subdomain 
				extension: hostname.slice(hostname.indexOf('crunchyroll.') + 11, hostname.length),
				loggedIn: isLoggedIn()
			});
		}
	} else {
		console.log('You are already registered in the US.');
		// delete login data when user logs out
		document.querySelectorAll('a[href$="/logout"]').forEach((a) => {
			console.log(a);
			a.addEventListener('click', () => {
				browser.storage.local.remove(['login', 'user', 'loginData']);
			});
		});
	}
});
