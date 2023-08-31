/* global bp */
bp.log.info("start")
const RED = {};

function cloneToken(token) {
  // return JSON.parse(JSON.stringify(token))
  return token
}
// function autoEval(att){
//   return eval(`node.${att}.replace(/tkn\./g, 'cloneToken.')`)
// }
var nodes = new Map();
var starts = [];
var disabledTabs = [];
var groups = {};
for (let n of model.config.flows) {
  if (n.type === 'tab' && n.disabled) {
    disabledTabs.push(n.id);
  } else if (n.type === 'group') {
    groups[n.id] = n;
  }
}
for (let n of model.config.flows) {
  if (!disabledTabs.includes(n.z) && !n.d) {
    nodes.set(n.id, n)
    if (n.type == "start") {
      bp.log.info("node is start")
      let token = n.payload || "{}";
      bp.log.info("tkn:" + token)
      n.token = token;
      bp.log.info("n: " + n)
      if (RED.nodeRedAdapter) {
        bp.log.info("RED.nodeRedAdapter")
        let t = JSON.parse(token);
        if (Array.isArray(t)) {
          bp.log.info("is an arr: " + t)
          for (let tkn of t) {
            RED.nodeRedAdapter.updateToken(n, tkn, true);
          }

        }
        else {
          bp.log.info("is not an arr: " + t)
          RED.nodeRedAdapter.updateToken(n, t, true);
        }

      }
      starts.push(n);
    }
  }
}
//-------------------------------------------------------------------------------
// Initial spawn
//-------------------------------------------------------------------------------

for (let n of starts) {
  let token = JSON.parse(n.token) || {};
  if (Array.isArray(token)) {
    for (let tkn of token) {
      spawn_bthread(n, tkn);
    }
  }
  else {
    spawn_bthread(n, token);
  }
}

//-------------------------------------------------------------------------------
// Each b-thread follows a path and spawns new b-threads when the path splits.
//-------------------------------------------------------------------------------
function spawn_bthread(node, token) {
  bthread("flow", function () {
    do {
      let tokens = execute(node, token) //[{sdfsdf},undefined]  [undefined,{sdfsdf}]
      if (RED.nodeRedAdapter) {
        bp.log.info("75: RED.nodeRedAdapter")
        RED.nodeRedAdapter.updateToken(node, token, false);
      }
      token = undefined

      for (let i in node.wires) {
        if (node.wires[i]) {
          if (tokens[i]) {
            for (let follower of node.wires[i]) {
              let followerNode = nodes.get(follower)
              let followerToken = JSON.parse(JSON.stringify(tokens[i]))
              if (RED.nodeRedAdapter) {
                RED.nodeRedAdapter.updateToken(followerNode, followerToken, true);
              }
              if (!token) {
                // The first token will be executed in this b-thread
                node = followerNode
                token = followerToken
              } else {
                // The other tokens will be executed in new b-threads
                spawn_bthread(followerNode, followerToken)
              }
            }
          }
        }
      }
    } while (token)
  })
}


//-------------------------------------------------------------------------------
// Here we define the semantics of the nodes.

//-------------------------------------------------------------------------------
function execute(node, token) {
  let cloneToken = JSON.parse(JSON.stringify(token))
  let event;
  let block = [];
  let waitFor = [];
  try {
    if (node.g) {
      let name = groups[node.g].name
      let matches = name.match(/Block *:? *\[([^\]]*).*break[ \-_]upon *:? *\[([^\]]*)/i)
      if (!matches) {
        throw new Error("A group name must be:\nblock: [<a comma separated list of blocks' names>] | break-upon: [<a comma separated list of blocks' names>]")
      }
      block = matches[1].split(',').map(v => v.trim()).map(v => v.replace(/"/g, '')).filter(v => v.length > 0)
      waitFor = matches[2].split(',').map(v => v.trim()).map(v => v.replace(/"/g, '')).filter(v => v.length > 0)

      for (let i = 0; i < block.length; i++) {
        bp.thread.data.block.push(Any(block[i]));
      }
      for (let i = 0; i < waitFor.length; i++) {
        bp.thread.data.waitFor.push(Any(waitFor[i]));
      }
    }
    switch (node.type) {
      //-----------------------------------------------------------------------
      // Start
      //-----------------------------------------------------------------------
      case "start":
        return [cloneToken]

      case "switch":
        return switchNode(node, cloneToken)
      case "log":
        if (node.level === 'info')
          bp.log.info(cloneToken)
        else if (node.level === 'warn')
          bp.log.warn(cloneToken)
        if (node.level === 'fine')
          bp.log.fine(cloneToken)
        return []
      case "loop":
        switch (node.type) {
          case "numbers":
            //todo: make "count" attribute unique
            if ("count" in cloneToken) {
              if (cloneToken.count + 1 < node.to) {
                cloneToken.count += parseInt(node.skip)
                return [cloneToken, undefined]
              } else {
                delete cloneToken.count
                return [undefined, cloneToken]
              }
            } else {
              cloneToken.count = parseInt(node.from)
              return [cloneToken, undefined]
            }
          case "list":
            //todo: implement this.
            return [cloneToken, undefined]
        }

      case "if-then-else":
        if (node.condition) {
          let condition = node.condition.replace(/tkn\./g, 'cloneToken.')
          if (eval(condition)) {  // "3333+1" -> 3334
            return [cloneToken, undefined]
          } else {
            return [undefined, cloneToken]
          }
        }
      case "add-attribute":
        if (node.value && node.attribute) {
          eval("cloneToken." + node.attribute + "=" + node.value.replace(/tkn\./g, 'cloneToken.'))
        }
        return [cloneToken]

      //-----------------------------------------------------------------------
      // bsync
      //-----------------------------------------------------------------------
      case "bsync":
        let stmt = {}
        if (cloneToken.request) {
          stmt.request = bp.Event(String(cloneToken.request))
          // delete cloneToken.request
        } else if (node.request != "") {
          stmt.request = bp.Event(String(eval(node.request.replace(/tkn\./g, 'cloneToken.'))))
        }

        if (cloneToken.waitFor) {
          stmt.waitFor = bp.Event(String(cloneToken.waitFor))
          // delete cloneToken.waitFor
        } else if (node.waitFor != "") {
          stmt.waitFor = bp.Event(String(eval(node.waitFor.replace(/tkn\./g, 'cloneToken.'))))
        }

        if (cloneToken.block) {
          stmt.block = bp.Event(String(cloneToken.block))
          // delete cloneToken.block
        } else if (node.block != "") {
          stmt.block = bp.Event(String(eval(node.block.replace(/tkn\./g, 'cloneToken.'))))
        }

        event = sync(stmt)
        cloneToken.selectedEvent = { name: String(event.name) }
        if (event.data != null) cloneToken.selectedEvent.data = event.data
        return [cloneToken]
      //-----------------------------------------------------------------------
      // wait all
      //-----------------------------------------------------------------------

      case "waitall":
        let waitstmt = {};
        if (!cloneToken.waitList) {
          if (node.waitList)
            cloneToken.waitList = eval(node.waitList.replace(/tkn\./g, 'cloneToken.'))
          else
            return [cloneToken]
        }

        do {
          let arr = [];
          for (let l of cloneToken.waitList)
            arr = arr.concat(l)
          for (i in arr)
            arr[i] = bp.Event(arr[i])
          waitstmt.waitFor = arr
          let event = sync(waitstmt)
          cloneToken.selectedEvent = { name: String(event.name) }
          if (event.data != null) cloneToken.selectedEvent.data = event.data
          for (i in cloneToken.waitList) {
            if (cloneToken.waitList[i].includes(event.name))
              cloneToken.waitList[i] = cloneToken.waitList[i].splice(cloneToken.waitList[i].indexOf(event.name), 1)
          }

        } while (!cloneToken.waitList.includes([]))
        return [cloneToken]


      default:
        if (this[node.type]) {
          this[node.type](node, cloneToken)
        } else {
          if (node.eventType == 'request') {
            defaultRequestEventDef(node, cloneToken);
          } else if (node.eventType == 'waitFor') {
            defaultWaitForEventDef(node, cloneToken);
          }
        }
        return [cloneToken]
    }
  } finally {
    for (let i = 0; i < block.length; i++) {
      bp.thread.data.block.pop()
    }
    for (let i = 0; i < waitFor.length; i++) {
      bp.thread.data.waitFor.pop()
    }
  }
}

function defaultWaitForEventDef(node, msg) {
  function conditionForField(msg, node, field) {
    let target = '';
    // bp.log.info("res node={0};msg={1}; field={2}", node,msg, field);
    if (msg[node.type] && msg[node.type][field.name]) {
      target = msg[node.type][field.name];
    } else if (node[field.name]) {
      target = node[field.name];
    }

    if (target !== '') {
      if (!Array.isArray(target) && (field.type !== 'select' || field.defaultValue != target)) {
        target = ' && e.data.' + field.name + ' == "' + target + '"';
      } else {
        target = ''
      }
    }

    return target;
  }

  let condition = 'bp.EventSet("", function(e) { return e.name.equals("' + node.type + '")';
  if (node.internalFields) {
    let fields = JSON.parse(node.internalFields);
    for (let i = 0; i < fields.length; i++) {
      condition += conditionForField(msg, node, fields[i]);
    }
  }
  condition += ' })'
  // bp.log.info("condition="+condition)
  let event = sync({ waitFor: eval(condition) })
  copyEventDataToToken(msg, event)
}

function defaultRequestEventDef(node, msg) {
  function setField(msg, node, field, target) {
    // bp.log.info("res node={0};msg={1}; field={2}", node,msg, field);
    if (msg[node.type] && msg[node.type][field.name]) {
      target[field.name] = msg[node.type][field.name];
    } else if (node[field.name]) {
      target[field.name] = node[field.name];
    }

    if (field.type === 'select' && (!target[field.name] || target[field.name] === field.defaultValue)) {
      target[field.name] = Object.keys(field.options).filter(key => key !== 'select');
    }

    if (Array.isArray(target[field.name])) {
      target[field.name] = choose(target[field.name]);
    }
  }

  // bp.log.info(node)
  let event;
  if (node.internalFields) {
    let data = {}
    let fields = JSON.parse(node.internalFields);
    for (let i = 0; i < fields.length; i++) {
      setField(msg, node, fields[i], data);
    }
    event = bp.Event(String(node.type), data)
  } else {
    event = bp.Event(String(node.type))
  }

  let stmt = {}
  stmt[node.eventType] = event
  // bp.log.warn(node.type + " was called, but the method does not exists.")
  // bp.log.info("asking for {0}, bp.thread.data={1}", stmt, bp.thread.data)
  sync(stmt)
  copyEventDataToToken(msg, event)
}

function copyEventDataToToken(token, event) {
  token.selectedEvent = { name: String(event.name) }
  if (event.data != null) {
    if (typeof event.data === 'object') {
      if (!token[event.name]) {
        token[event.name] = {}
      }
      Object.assign(token[event.name], event.data)
    } else {
      token[event.name] = event.data
    }
  }
  token.selectedEvent.data = event.data
}