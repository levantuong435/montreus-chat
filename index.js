/* server/index.js
 * Main Server File
 * Open-source! Free for all
*/

//Node.js Standard Modules
var path = require("path");
var http = require('http');
var fs = require("fs");

//NPM Modules
var express = require("express");
var socketIO = require('socket.io');
var moment = require('moment');
var bodyParser = require('body-parser');
var compression = require('compression');
var markdownIt = require('markdown-it');

//montreus-chat Modules
var rooms = require("./room"); //JSON with Rooms
var db = require("./database");
var errorPage = require("./error-page");

//Module Setup
var app = express();
var server = http.Server(app);
var io = socketIO(server);
var markdown = markdownIt({
    html: false,
    xhtmlOut: true,
    breaks: true,
    langPrefix: 'language-',
    linkify: true,
    typographer: true,
    quotes: '“”‘’',
    highlight: function() {return '';}
});
var urlencodedParser = bodyParser.urlencoded({ extended: false });

//Init Room List
var publicRooms = [];
for(i = 0; i < rooms.length; i++){
    var roomAtIndex = rooms[i];
    if(roomAtIndex.public == true){
        publicRooms.push(roomAtIndex);
    }
}

//Connection Handlers
app.get('/', function(req, res){
    res.set('Content-Type', 'text/html');
    res.status(200).render("list.ejs", {rooms: publicRooms});
});

app.set("views", path.resolve("views"));
//Uses EJS
var roomRouter = express.Router();

roomRouter.get('/room/:id/', function(req, res,next){
    var id = req.params.id;
    var roomName;
    var roomId;
    var roomPassword;
    var roomIndex = rooms.indexOf(socket.handshake.query.room);
    if(roomIndex != -1){
        var room = rooms[roomIndex];
        roomName = room.name;
        roomId = room.roomId;
        roomPassword = room.password;
    }
    if(roomName == null){
        res.status(404).render("error.ejs", {title: 'Montreus Chat', error: "Uh oh! This room sadly doesn't exist."});
    }else{
        res.set('Content-Type', 'text/html');
        if(roomPassword != null){
            res.status(200).render("room.ejs", {title: roomName, id: id, isPasswordProtected: true});
        }else{
            res.status(200).render("room.ejs", {title: roomName, id: id, isPasswordProtected: false});
        }
      
    }
});
roomRouter.use(compression({ threshold: 512 }));
app.use(roomRouter);

//Public Folder
var pagesRouter = express.Router();
pagesRouter.use(express.static(__dirname + '/public'));
pagesRouter.use(compression({ threshold: 512 }));
app.use('/', pagesRouter);

//404 Router
app.use(errorPage);

//Sockets
io.on('connection', function(socket){
    if(socketConnections().length <= 1024){
        socket.username = socket.handshake.query.username;
        socket.join(socket.handshake.query.room);
        var roomName;
        var roomId;
        var roomPassword;
        var isPublic;
        var enteredPassword = socket.handshake.query.password;
        //Look for room with the name
        var roomIndex = rooms.indexOf(socket.handshake.query.room);
        if(roomIndex != -1){
            var room = rooms[roomIndex];
            roomName = room.name;
            roomId = room.roomId;
            roomPassword = room.password;
            isPublic = room.public;
        }

        if(!isPublic) {
            if(roomPassword + '' == enteredPassword){
                db.find(socket.handshake.query.room).then(function(messages){
                    socket.emit('old messages', messages);
             
                }, function(error){
                    socket.emit('error event', 'Uh oh! An error ocurred: ' + error.message);
                });
            }else{
                socket.emit('error event', 'Incorrect password, please refresh the page and try again.');
            }
        }else{
            db.find(socket.handshake.query.room).then(function(messages){
                socket.emit('old messages', messages)
            }, function(error){
                socket.emit('error event', 'Uh oh! An error ocurred: ' + error.message);
            });
        }

        socket.on('postName', function(username){
                socket.username = username;
                });
        var socketsConnected = socketConnections(socket.handshake.query.room);
        io.in(socket.handshake.query.room).emit('connections', socketsConnected.length + 1);
        socket.on('chat message', function(msg){
            if(!verifyEmptyness(msg.message)){
                var result = processMessage(msg);
                if(result.sendToAll === true){
                    io.in(socket.handshake.query.room).emit('chat message', result);
                    db.add(result, socket.handshake.query.room);
                }else{
                    socket.emit('chat message', result);
                }
            }else{
                var time = moment(time).format("LT, D/M");
                socket.emit('chat message', createResponse('','You may not send empty messages',time, '', true,false, false));
            }
        });
      socket.on('users', function(){
                var socketsConnected = socketConnections(socket.handshake.query.room);
                io.in(socket.handshake.query.room).emit('connections', socketsConnected.length + 1);
                });
      socket.on('disconnect', function(){
                var socketsConnected = socketConnections(socket.handshake.query.room);
                io.in(socket.handshake.query.room).emit('connections', socketsConnected.length + 1);
                });
      }else{
      socket.emit('chat message', createResponse('PM','Sorry, we cannot allow more than 1024 connections in the server',time, ': ', true,false, false));
      socket.emit('chat message',  createResponse('PM','Disconnecting! Try again later.',time, ': ', true,false, false));
      socket.emit('connections', 'You are not connected.');
      socket.disconnect();
      }
});

var processMessage = function(message){
    var time = moment(new Date()).format("LT, D/M");
    var response;
    if(message.message.length <= 8192){
    if(message.message.slice(0,1) !== "/"){
        response = createResponse(message.username, message.message,time, ': ', true,true, true);
    }else{
        var command = firstWord(message.message);
        switch(command.toLowerCase()){
            case "/help":
            response = createResponse('',"Montreus Chat - v2.4.1<br>Available commands:<br>/help - Display help commands<br>/bot-say &lt;message&gt; - Give something for the bot to say!<br>/broadcast &lt;message&gt; - Broadcast a message<br>/version - See the current Montreus Chat version</p>", time, '', false,false, false);
            break;
            case "/bot-say":
                var msg = otherWords(message.message);
                if(msg.length <= 0){
                    response = createResponse('PM','Uh oh! You forgot the message: /bot-say &lt;message&gt;', time, ': ', true, false, true);
                }else{
                    response = createResponse('Chat bot',msg, time, ': ', true, true, true);
                }
            break;
            case "/broadcast":
                var msg = otherWords(message.message);
                if(msg.length <= 0){
                    response = createResponse('PM','Uh oh! You forgot the message: /broadcast &lt;message&gt;', time, ': ', true, false, true);
                }else{
                    response = createResponse('BROADCAST',msg, time, ': ', true, true, true);
                }
            break;
            case "/me":
                response = createResponse('', 'Montreus Chat - v2.4.1<br>Username: ' + message.username, time, '', false, false, true);
            break;
            case "/version":
                response = createResponse('', 'Montreus Chat - v2.4.1', time, '', false, false, false);
            break;
            default:
                response = createResponse('', 'Invalid command', time, '', false, false, false);
        }
    }
    }else{
        response = createResponse('PM', 'Uh oh! Sorry, you cannot send messages longer than 8192 characters.', time, '', false, false, false);
    }
    return response;
}

var createResponse = function(username, message, time, usernameMessageSperator, processMarkdown, sendToAll, notify){
  
    var response = {
        username : html.escape(username),
        message : message,
        processMarkdown : processMarkdown,
        time : time,
        usernameMessageSperator : usernameMessageSperator,
        sendToAll : sendToAll,
        notify: notify
    };
    if(processMarkdown === true){
        msg = markdown.renderInline(message);
        response.message = msg;
    }
    return(response);
};
var firstWord = function(string){
    if(string.indexOf(" ") == -1){
        return string;
    }
    return string.substr(0, string.indexOf(" "));
}
var otherWords = function(string){
      if(string.indexOf(" ") == -1){
        return '';
    }
    return string.substr(string.indexOf(" ") + 1,string.length);
}
server.listen(3030, function(){
            console.log('listening on *:3030');
            });
var verifyEmptyness = function(str) {
    return (str.length === 0 || !str.trim());
};
function socketConnections(roomId, namespace) {
    var res = [];
    var ns = io.of(namespace ||"/");

    if (ns) {
        for (var id in ns.connected) {
            if(roomId) {
                var index = ns.connected[id].rooms.indexOf(roomId);
                if(index !== -1) {
                    res.push(ns.connected[id]);
                }
            } else {
                res.push(ns.connected[id]);
            }
        }
    }
    return res;
}
var html = {
    escape: function(text) {
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }
}
