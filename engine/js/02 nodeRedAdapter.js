RED.nodeRedAdapter = {
  clientSocket: undefined,
  outStream: undefined,
  inStream: undefined,

  AdapterMessageTypes: {
    RUN: "RUN",
    DEBUG: "DEBUG",
    STEP: "STEP",
    STOP: "STOP"
  },

  EngineMessageTypes: {
    STATE: "STATE",
    LOG: "LOG"
  },

  startConnection: function () {
    this.clientSocket = new java.net.Socket('localhost', 1234);
    this.outStream = new java.io.PrintWriter(this.clientSocket.getOutputStream(), true);
    this.inStream = new java.io.BufferedReader(new java.io.InputStreamReader(this.clientSocket.getInputStream()));
  },

  closeConnection: function () {
    try {
      this.clientSocket.close();
    } catch (e) {
    }
  },

  sendMessage: function (msg) {
    this.outStream.println(JSON.stringify(msg));
  },

  receiveMessage: function () {
    return JSON.parse(this.inStream.readLine());
  },

  updateToken: function (n, token, add) {
    this.sendMessage(this.Message(this.EngineMessageTypes.STATE, {id: n.id, add: add, token: token}))
    java.lang.Thread.sleep(500)
  },

  Message: function (type, payload) {
    return {
      type: type,
      payload: payload
    }
  }
}

RED.nodeRedAdapter.startConnection()