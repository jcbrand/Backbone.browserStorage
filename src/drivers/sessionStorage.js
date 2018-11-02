// Copyright 2014 Mozilla
// Copyright 2015 Thodoris Greasidis
// Copyright 2018 JC Brand
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
// http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import executeCallback from '../utils/executeCallback';
import getCallback from '../utils/getCallback';
import normalizeKey from '../utils/normalizeKey';
import serializer from '../utils/serializer';


function isSessionStorageValid () {
    // If the app is running inside a Google Chrome packaged webapp, or some
    // other context where sessionStorage isn't available, we don't use
    // sessionStorage. This feature detection is preferred over the old
    // `if (window.chrome && window.chrome.runtime)` code.
    // See: https://github.com/mozilla/localForage/issues/68
    try {
        // If sessionStorage isn't available, we get outta here!
        // This should be inside a try catch
        if (sessionStorage && ('setItem' in sessionStorage)) {
            return true;
        }
    } catch (e) {
        console.log(e);
    }
    return false;
}

function _getKeyPrefix(options, defaultConfig) {
    var keyPrefix = options.name + '/';

    if (options.storeName !== defaultConfig.storeName) {
        keyPrefix += options.storeName + '/';
    }
    return keyPrefix;
}

function _initStorage(options) {
    var self = this;
    var dbInfo = {};
    if (options) {
        for (var i in options) { // eslint-disable-line guard-for-in
            dbInfo[i] = options[i];
        }
    }

    dbInfo.keyPrefix = _getKeyPrefix(options, self._defaultConfig);
    self._dbInfo = dbInfo;
    dbInfo.serializer = serializer;
}

// Remove all keys from the datastore, effectively destroying all data in
// the app's key/value store!
function clear(callback) {
    var self = this;
    var promise = self.ready().then(function() {
        var keyPrefix = self._dbInfo.keyPrefix;

        for (var i = sessionStorage.length - 1; i >= 0; i--) {
            var key = sessionStorage.key(i);

            if (key.indexOf(keyPrefix) === 0) {
                sessionStorage.removeItem(key);
            }
        }
    });

    executeCallback(promise, callback);
    return promise;
}

// Retrieve an item from the store. Unlike the original async_storage
// library in Gaia, we don't modify return values at all. If a key's value
// is `undefined`, we pass that value to the callback function.
function getItem(key, callback) {
    var self = this;

    key = normalizeKey(key);

    var promise = self.ready().then(function() {
        var dbInfo = self._dbInfo;
        var result = sessionStorage.getItem(dbInfo.keyPrefix + key);

        // If a result was found, parse it from the serialized
        // string into a JS object. If result isn't truthy, the key
        // is likely undefined and we'll pass it straight to the
        // callback.
        if (result) {
            result = dbInfo.serializer.deserialize(result);
        }

        return result;
    });

    executeCallback(promise, callback);
    return promise;
}

// Iterate over all items in the store.
function iterate(iterator, callback) {
    var self = this;

    var promise = self.ready().then(function() {
        var dbInfo = self._dbInfo;
        var keyPrefix = dbInfo.keyPrefix;
        var keyPrefixLength = keyPrefix.length;
        var length = sessionStorage.length;

        // We use a dedicated iterator instead of the `i` variable below
        // so other keys we fetch in sessionStorage aren't counted in
        // the `iterationNumber` argument passed to the `iterate()`
        // callback.
        //
        // See: github.com/mozilla/localForage/pull/435#discussion_r38061530
        var iterationNumber = 1;

        for (var i = 0; i < length; i++) {
            var key = sessionStorage.key(i);
            if (key.indexOf(keyPrefix) !== 0) {
                continue;
            }
            var value = sessionStorage.getItem(key);

            // If a result was found, parse it from the serialized
            // string into a JS object. If result isn't truthy, the
            // key is likely undefined and we'll pass it straight
            // to the iterator.
            if (value) {
                value = dbInfo.serializer.deserialize(value);
            }

            value = iterator(
                value,
                key.substring(keyPrefixLength),
                iterationNumber++
            );

            if (value !== void 0) { // eslint-disable-line no-void
                return value;
            }
        }
    });

    executeCallback(promise, callback);
    return promise;
}

// Same as sessionStorage's key() method, except takes a callback.
function key(n, callback) {
    var self = this;
    var promise = self.ready().then(function() {
        var dbInfo = self._dbInfo;
        var result;
        try {
            result = sessionStorage.key(n);
        } catch (error) {
            result = null;
        }

        // Remove the prefix from the key, if a key is found.
        if (result) {
            result = result.substring(dbInfo.keyPrefix.length);
        }

        return result;
    });

    executeCallback(promise, callback);
    return promise;
}

function keys(callback) {
    var self = this;
    var promise = self.ready().then(function() {
        var dbInfo = self._dbInfo;
        var length = sessionStorage.length;
        var keys = [];

        for (var i = 0; i < length; i++) {
            var itemKey = sessionStorage.key(i);
            if (itemKey.indexOf(dbInfo.keyPrefix) === 0) {
                keys.push(itemKey.substring(dbInfo.keyPrefix.length));
            }
        }

        return keys;
    });

    executeCallback(promise, callback);
    return promise;
}

// Supply the number of keys in the datastore to the callback function.
function length(callback) {
    var self = this;
    var promise = self.keys().then(function(keys) {
        return keys.length;
    });

    executeCallback(promise, callback);
    return promise;
}

// Remove an item from the store, nice and simple.
function removeItem(key, callback) {
    var self = this;

    key = normalizeKey(key);

    var promise = self.ready().then(function() {
        var dbInfo = self._dbInfo;
        sessionStorage.removeItem(dbInfo.keyPrefix + key);
    });

    executeCallback(promise, callback);
    return promise;
}

// Set a key's value and run an optional callback once the value is set.
// Unlike Gaia's implementation, the callback function is passed the value,
// in case you want to operate on that value only after you're sure it
// saved, or something like that.
function setItem(key, value, callback) {
    var self = this;

    key = normalizeKey(key);

    var promise = self.ready().then(function() {
        // Convert undefined values to null.
        // https://github.com/mozilla/localForage/pull/42
        if (value === undefined) {
            value = null;
        }

        // Save the original value to pass to the callback.
        var originalValue = value;

        return new Promise(function(resolve, reject) {
            var dbInfo = self._dbInfo;
            dbInfo.serializer.serialize(value, function(value, error) {
                if (error) {
                    reject(error);
                } else {
                    try {
                        sessionStorage.setItem(dbInfo.keyPrefix + key, value);
                        resolve(originalValue);
                    } catch (e) {
                        // sessionStorage capacity exceeded.
                        // TODO: Make this a specific error/event.
                        if (
                            e.name === 'QuotaExceededError' ||
                            e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
                        ) {
                            reject(e);
                        }
                        reject(e);
                    }
                }
            });
        });
    });

    executeCallback(promise, callback);
    return promise;
}

function dropInstance(options, callback) {
    callback = getCallback.apply(this, arguments);

    options = (typeof options !== 'function' && options) || {};
    if (!options.name) {
        var currentConfig = this.config();
        options.name = options.name || currentConfig.name;
        options.storeName = options.storeName || currentConfig.storeName;
    }

    var self = this;
    var promise;
    if (!options.name) {
        promise = Promise.reject(new Error('Invalid arguments'));
    } else {
        promise = new Promise(function(resolve) {
            if (!options.storeName) {
                resolve(`${options.name}/`);
            } else {
                resolve(_getKeyPrefix(options, self._defaultConfig));
            }
        }).then(function(keyPrefix) {
            for (var i = sessionStorage.length - 1; i >= 0; i--) {
                var key = sessionStorage.key(i);

                if (key.indexOf(keyPrefix) === 0) {
                    sessionStorage.removeItem(key);
                }
            }
        });
    }

    executeCallback(promise, callback);
    return promise;
}

const sessionStorageWrapper = {
    _driver: 'sessionStorageWrapper',
    _initStorage: _initStorage,
    _support: isSessionStorageValid(),
    iterate: iterate,
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    clear: clear,
    length: length,
    key: key,
    keys: keys,
    dropInstance: dropInstance
};

export default sessionStorageWrapper;
