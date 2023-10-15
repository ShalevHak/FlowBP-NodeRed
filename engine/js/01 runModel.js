/* global bp */
bp.log.info("start")
const RED = {};
//todo: fix bugs
function processPayload(payload) {//processing the payload from 'start' nodes. Enabling loop comprehension to define array of tokens
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
        const result = array.map(item => {
          const objStrWithVar = objectStr.replace(new RegExp(variableName, 'g'), JSON.stringify(item))
          return objStrWithVar;
        })

        return "["+result+"]"
      }
    }
  }
  // If the payload doesn't match the specified format, return it as is
  return payload;
}
function processEvent(event, cloneToken){
  let e = eval(processPayload(event.replace(/tkn\./g, 'cloneToken.')))

  if (Array.isArray(e)){
    let eventsArr =[]
    for (var i=0;i<e.length;i++){
      eventsArr.push(bp.Event(String(e[i])))
    }
    return eventsArr
  }
  return bp.Event(String(e))
}
function cloneToken(token) {
  // return JSON.parse(JSON.stringify(token))
  return token
}
function autoEval(att){
  return eval(`node.${att}.replace(/tkn\./g, 'cloneToken.')`)
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
      let token = processPayload(n.payload)|| "{}";
      n.token = token;
      // bp.log.info("n: " + n)
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
        switch (node.loopover) {
          
          case "numbers":
            if (eval("cloneToken.count_"+node.id)!=null) {
              if (eval("cloneToken.count_"+node.id) < node.to) {
                eval("cloneToken.count_"+node.id  +"+="+parseInt(node.skip))
                return [cloneToken, undefined]
              } else {
                eval("cloneToken.count_"+node.id+"="+null)//Deleting the unique count attribute after exiting the loop
                return [undefined, cloneToken]
              }
            } else {
              eval("cloneToken.count_"+node.id + "=" +parseInt(node.from))//Adding a unique count attribute named after the node's id
              return [cloneToken, undefined]
            }
          case "list":
            if (eval("cloneToken.count_"+node.id)!=null) {
              if (eval("cloneToken.list_"+node.id).length>1) {
                  eval("cloneToken.list_"+node.id).splice(0,1)//Deletes the first element of the list
                  eval("cloneToken.count_"+node.id+"="+eval("cloneToken.list_"+node.id)[0])//Sets the element as the new first element
                return [cloneToken, undefined]
              } else {
                eval("cloneToken.count_"+node.id+"="+null)//Deleting the unique element attribute after exiting the loop
                return [undefined, cloneToken]
              }
            } else {
              eval("cloneToken.list_"+node.id+"="+node.list)
              eval("cloneToken.count_"+node.id+"="+eval(node.list)[0])//Adding a unique element attribute named after the node's id
              return [cloneToken, undefined]
            }
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
      case "set-attribute":
        if (node.value && node.attribute) {
          eval("cloneToken." + node.attribute + "=" + node.value.replace(/tkn\./g, 'cloneToken.'))
        }
        return [cloneToken]

      //-----------------------------------------------------------------------
      // bsync
      //-----------------------------------------------------------------------
      //todo: implement bSync of array of events
      case "bsync":
        let stmt = {}
        
        if (cloneToken.request) {
          stmt.request = processEvent(cloneToken.request,cloneToken)
          cloneToken.request = null;
        } else if (node.request != "") {
          stmt.request = processEvent(node.request,cloneToken)
        }

        if (cloneToken.waitFor) {
          stmt.waitFor = processEvent(cloneToken.waitFor,cloneToken)
          cloneToken.waitFor = null;
        } else if (node.waitFor != "") {
          stmt.waitFor = processEvent(node.waitFor,cloneToken)
        }

        if (cloneToken.block) {
          stmt.block = processEvent(cloneToken.block,cloneToken)
          cloneToken.block = null;
        } else if (node.block != "") {
          stmt.block = processEvent(node.block)
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
        var flag=true;
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
              {
                cloneToken.waitList[i].splice(cloneToken.waitList[i].indexOf(event.name), cloneToken.waitList[i].indexOf(event.name)+1)
                // bp.log.info("splice: "+event.name+cloneToken.waitList[i])
                if(cloneToken.waitList[i].length==0){
                  flag=false;
                }
              }
            
          }

        } while (flag)
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