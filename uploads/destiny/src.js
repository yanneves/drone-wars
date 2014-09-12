/* jshint worker: true, latedef: false */
/* global cortex */

/**
 * Aggressor uses the cortex queue system to organize actions.
 */

// Import cortex for helpers.
importScripts('/scripts/brains/cortex.js');

// cache time
var cacheT;
/** Calculate time difference between frames */
function diff() {
  var t = new Date().getTime(),
    diff =  t - (cacheT || t);
  cacheT = t;
  return diff;
}

// found this in source!
var shellSpeed = 0.75;

// cache target's angle
var targetTracker = {};

// field width
var width;
// field height
var height;

// corners enum
var corners;

// starting corner
var targetCorner;
// space around edge
var bufferX = 400;
var bufferY = 250;

// clockwise
function nextCorner(currentCorner) {
  var next;
  switch (currentCorner) {
    case 'tl':
      next = 'bl';
      break;
    case 'tr':
      next = 'tl';
      break;
    case 'bl':
      next = 'br';
      break;
    case 'br':
      next = 'tr';
      break;
  }
  return next;
}

function arrivedAtCorner(targetCorner, x, y) {
  var arrived,
      // margin of error
      top = height - bufferY - 20,
      right = width - bufferX - 20,
      bottom = bufferY + 20,
      left = bufferX + 20;
  switch (targetCorner) {
    case 'tl':
      arrived = x < left && y < bottom;
      break;
    case 'tr':
      arrived = x > right && y < bottom;
      break;
    case 'bl':
      arrived = x < left && y > top;
      break;
    case 'br':
      arrived = x > right && y > top;
      break;
  }
  return arrived;
}

/** SNIPE hunt! */
function snipe(id) {
  'use strict';

  return function (data, callback) {
    var dt = diff();
    var robot = data.robot;
    var enemy = data.status.robots[id];

    if (width == null) width = data.status.field.width;
    if (height == null) height = data.status.field.height;
    if (corners == null) {
      corners = {
        // opposite
        'bl': {x: bufferX, y: height - bufferY},
        'br': {x: width - bufferX, y: height - bufferY},
        'tl': {x: bufferX, y: bufferY},
        'tr': {x: width - bufferX, y: bufferY}
      };
    }

    var message = {
      acceleration: { x: 0, y: 0 },
      token: data.token
    };

    if (targetCorner != null) {
      if (arrivedAtCorner(targetCorner, robot.position.x, robot.position.y)) {
        targetCorner = nextCorner(targetCorner);
      }
    } else {
      targetCorner = 'tl';
      // target closest corner at start,
      // defaults top-left
      ['tr', 'bl', 'br'].forEach(function(corner) {
        var dx1 = corners[targetCorner].x - robot.position.x;
        var dy1 = corners[targetCorner].y - robot.position.y;
        var dh1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        var dx2 = corners[corner].x - robot.position.x;
        var dy2 = corners[corner].y - robot.position.y;
        var dh2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        targetCorner = (dh1 > dh2) ? corner : targetCorner;
      });
    }

    var dcx = corners[targetCorner].x - robot.position.x;
    var dcy = corners[targetCorner].y - robot.position.y;
    var dch = Math.sqrt(dcx * dcx + dcy * dcy);

    message.acceleration.x = dcx / dch * (robot.maxAcceleration * 0.75);
    message.acceleration.y = dcy / dch * (robot.maxAcceleration * 0.75);

    // If there is no enemy with this ID, then this action is finished.
    if (!enemy) {

      // I need a new target.
      queue.add(target);

      // This action is done.
      return callback(null, message, true);
    }

    // determine angle,
    // currently limited to positive or negative
    var ngx = 1;
    var ngy = 1;
    if (targetTracker.x != null && targetTracker.y != null) {
      ngx = (enemy.position.x > targetTracker.x) ? 1 : -1;
      ngy = (enemy.position.y > targetTracker.y) ? 1 : -1;
    }
    // track position for next time
    targetTracker.x = enemy.position.x;
    targetTracker.y = enemy.position.y;

    var dx = enemy.position.x - robot.position.x;
    var dy = enemy.position.y - robot.position.y;
    var dh = Math.sqrt(dx * dx + dy * dy);

    // Anticipate enemy movement to snipe effectively
    // predict based on current framerate
    // and eta of projectile
    var dp = dh * shellSpeed;
    var px = enemy.position.x + ((enemy.velocity.x + (robot.maxAcceleration * (dt + dp))) * ngx) + 20 * ngx;
    var py = enemy.position.y + ((enemy.velocity.y + (robot.maxAcceleration * (dt + dp))) * ngy) + 20 * ngy;

    // If I have reloaded, fire at the enemy.
    if (robot.timeSinceLastShot >= robot.rearmDuration) {
      message.fire = { x: px, y: py };
    }

    callback(null, message, false);
  };
}

function target(data, callback) {
  'use strict';

  var robots = data.status.robots;
  var robot = data.robot;

  var message = {
    acceleration: { x: 0, y: 0 },
    token: data.token
  };

  // Make a list of enemy IDs.
  var ids = Object.keys(robots);

  // Remove my ID from the list.
  ids.splice(ids.indexOf(robot.id), 1);

  // Select a random target.
  var targetId = ids[Math.floor(Math.random() * ids.length)];

  // No target was selected, so I'm the only one left in the battlefield. Someone may arrive later
  // though, so continue to target.
  if (!targetId) {
    return callback(null, message, false);
  }

  // A new target has been acquired. Time to go sniping.
  queue.add(snipe(targetId));

  // This action is now done.
  callback(null, message, true);
}

// Create the queue.
var queue = new cortex.Queue();

// The first action is to target an enemy.
queue.add(target);

// Feed the queue to cortex.init to begin listening for data from my body.
cortex.init(queue.decider);
