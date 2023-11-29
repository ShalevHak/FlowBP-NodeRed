/* global bp */
bp.log.info("start")
const RED = {};
/**
 * Convert a string to an object or an array. 
 * The string can be of the form of JavaScript code or of the syntax: '{num:i,age: tkn.age} for i of tkn.arr'.
 * The function can be called with out the tkn parameter e.g. in the case of start nodes, in which the string cannot contain the tkn.
 * 
 * @param {string} payload - a text inputed by the user in some field representing an object or an array of objects
 * @param {object} tkn - the token that the user can refer to.
 * @returns {object} or {array} result
 */
function processPayload(payload, tkn) {

  if (typeof payload !== 'string') throw new Error("processPayload assumes a string")

  // Split the payload into parts
  const parts = payload.split(" for ");
  if (parts.length === 2) {
    const objectStr = parts[0].trim();
    const iterationStr = parts[1].trim().split(" of ");

    if (iterationStr.length === 2) {
      const variableName = iterationStr[0].trim();
      const arrayStr = iterationStr[1].trim();
      // Evaluate the array expression
      const array = eval(arrayStr);
      if (Array.isArray(array)) {
        // Create an array of objects using the provided expression
        const arrayMap = '[' + array + '].map(' + variableName + ' => (' + objectStr + '))'
        const result = eval(arrayMap)
        return result
      }
    }
  }
  // If the payload doesn't match the specified format, use eval and return
  return eval(payload);
}
function processEvent(event, tkn) {
  let e = processPayload(event, tkn)
  if (Array.isArray(e)) {
    let eventsArr = []
    for (var i = 0; i < e.length; i++) {
      eventsArr.push(bp.Event(String(e[i])))
    }
    return eventsArr
  }
  return bp.Event(String(e))
}
function GetAttribute(att, Token) {
  return Token[att]
}
function SetAttribute(att, value, Token) {
  Token[att] = value
}
function GetTknAtt(str, Token) {
  const pattern = /tkn\.(\w+)/g;
  const resultString = str.replace(pattern, (match, p1) => Token[p1]);
  return resultString;
}


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
      // bp.log.info("node is start")
      // bp.log.info("unprocessed: "+eval(n.payload))
      // bp.log.info("processed payload: "+processPayload(eval(n.payload)))
      let payload = n.payload || "{}"
      let token = processPayload(payload)/*eval(payload)*/
      n.token = token;
      // if (RED.nodeRedAdapter) {
      //   bp.log.info("RED.nodeRedAdapter")
      //   let t = JSON.parse(token);
      //   if (Array.isArray(t)) {
      //     bp.log.info("is an arr: " + t)
      //     for (let tkn of t) {
      //       RED.nodeRedAdapter.updateToken(n, tkn, true);
      //     }

      //   }
      //   else {
      //     bp.log.info("is not an arr: " + t)
      //     RED.nodeRedAdapter.updateToken(n, t, true);
      //   }

      // }
      starts.push(n);
    }
  }
}
//-------------------------------------------------------------------------------
// Initial spawn
//-------------------------------------------------------------------------------

for (let n of starts) {
  let token = n.token || {};
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
  let tkn = JSON.parse(JSON.stringify(token))
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
        return [tkn]

      case "switch":
        return switchNode(node, tkn)
      case "log":
        if (node.level === 'info')
          bp.log.info(tkn)
        else if (node.level === 'warn')
          bp.log.warn(tkn)
        if (node.level === 'fine')
          bp.log.fine(tkn)
        return []
      case "loop":

        let counterVarName = "count_" + node.id
        if (node.varName) {
          counterVarName = node.varName
        }

        switch (node.loopOver) {

          case "numbers":
            if (eval("tkn."+counterVarName+"!= null")) {
              if (eval("tkn."+counterVarName+"+ < node.to")) {
                eval("tkn."+counterVarName +"+= parseInt(node.skip)")
                return [tkn, undefined]
              } else {
                eval("tkn."+counterVarName+" = null")//Deleting the unique count attribute after exiting the loop
                return [undefined, tkn]
              }
            } else {
              eval("tkn." + counterVarName + "=" + parseInt(node.from))//Adding a unique count attribute named after the node's id
              return [tkn, undefined]
            }
          case "list":
            if (eval("tkn."+counterVarName+"!= null")) {
              if (eval("tkn.list_" + counterVarName+".length > 1")) {//Todo: remove eval
                eval("tkn.list_" + counterVarName + ".splice(0,1)")//Deletes the first element of the list
                eval("tkn." + counterVarName + "=" + "tkn.list_" + counterVarName + "[0]")//Sets the element as the new first element
                return [tkn, undefined]
              } else {
                eval("tkn." + counterVarName + "=" + null)//Deleting the unique element attribute after exiting the loop

                return [undefined, tkn]
              }
            }
            else {
              let list = processPayload(node.list, tkn)
              eval("tkn.list_" + counterVarName + "=" + list)
              eval("tkn." + counterVarName + "=" + list + "[0]")//Adding a unique element attribute named after the node's id
              return [tkn, undefined]
            }
        }

      case "if-then-else":
        if (node.condition) {
          if (eval(node.condition)) {  // "3333+1" -> 3334
            return [tkn, undefined]
          } else {
            return [undefined, tkn]
          }
        }
      case "set-attribute":

        if (node.value && node.attribute) {
          try{
            eval("tkn." + node.attribute + "=" + (processPayload(node.value,tkn)))
          }
          catch(err){
            bp.log.info("error: "+err+"\n"+"Node id: "+node.id+"\n Evaluated string: "+"tkn." + node.attribute + "=" + (processPayload(node.value,tkn))
            +"\n Original code: "+node.value);
          }
        }
        return [tkn]

      //-----------------------------------------------------------------------
      // bsync
      //-----------------------------------------------------------------------
      case "bsync":
        let stmt = {}
        if (node.priority) {
          tkn.priority = eval(node.priority)
        }
        else {
          tkn.priority = Infinity
        }
        if (tkn.request) {
          stmt.request = processEvent(tkn.request, tkn)
          tkn.request = null;
        } else if (node.request != "") {
          stmt.request = processEvent(node.request, tkn)
        }

        if (tkn.waitFor) {
          stmt.waitFor = processEvent(tkn.waitFor, tkn)
          tkn.waitFor = null;
        } else if (node.waitFor != "") {
          stmt.waitFor = processEvent(node.waitFor, tkn)
        }

        if (tkn.block) {
          stmt.block = processEvent(tkn.block, tkn)
          tkn.block = null;
        } else if (node.block != "") {
          stmt.block = processEvent(node.block, tkn)
        }

        event = sync(stmt, -tkn.priority)
        tkn.selectedEvent = { name: String(event.name) }
        if (event.data != null) tkn.selectedEvent.data = event.data
        return [tkn]
      //-----------------------------------------------------------------------
      // wait all
      //-----------------------------------------------------------------------
      case "waitall":

        if (!tkn.waitList) {
          if (node.waitList) {
            let code = processPayload(node.waitList, tkn)
            try {
              tkn.waitList = eval(code)//process payload
            }
            catch (error) {
              bp.log.warn("Error in: " + code + "  (" + error + ")")
            }
          }

          else
            return [tkn]
        }
        let isNotArr = false;
        for (let l of tkn.waitList) {
          if (!Array.isArray(l)) {
            isNotArr = true
          }
        }
        if (isNotArr) {
          tkn.waitList = [tkn.waitList]
        }
        let waitstmt = {};
        var flag = true;
        do {
          let arr = [];
          for (let l of tkn.waitList)
            arr = arr.concat(l)
          for (i in arr)
            arr[i] = bp.Event(arr[i])
          waitstmt.waitFor = arr
          let event = sync(waitstmt)
          tkn.selectedEvent = { name: String(event.name) }
          if (event.data != null) tkn.selectedEvent.data = event.data
          for (let i of tkn.waitList) {
            bp.log.fine(i)
            if (i.includes(event.name)) {
              i.splice(i.indexOf(event.name), 1)
              // let I =tkn.waitList[i].indexOf(event.name)
              // tkn.waitList[i] = tkn.waitList[i].filter(function(item, index) {
              //   return index !== I;
              // });
              let l = i.length
              if (l == 0) {
                flag = false;
              }
            }

          }

        } while (flag)
        return [tkn]


      default:
        if (this[node.type]) {
          this[node.type](node, tkn)
        } else {
          if (node.eventType == 'request') {
            defaultRequestEventDef(node, tkn);
          } else if (node.eventType == 'waitFor') {
            defaultWaitForEventDef(node, tkn);
          }
        }
        return [tkn]
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