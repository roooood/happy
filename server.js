var colyseus = require('colyseus');
//var request  = require('superagent');
var request = require('request');
var En       = require('./encrypt');

const inDev  = false;
const fnlSrv = "https://echoteam.ir/happy/?server";
const devSrv = "http://localhost/happy/?server";

class metaData{
  constructor (data) {
    data = JSON.parse(decodeURIComponent(data));
    this.bet        = data.bet;
    this.title      = data.title;
    this.round      = data.round;
    this.type       = data.type;
    this.player     = data.player;
    this.ready      = 0;
    this.creator    = data.creator || null;
    this.creatorId  = data.creatorId || 0;
  }
}
class Player{
  constructor (client,data) {
    this.sit     = 0;
    this.name    = data.name;
    this.id      = data.id;
    this.session = client.sessionId;
  }
}
class State{
  constructor () {
    this.Started = false;
    this.Sit     = {};
    this.Point   = {};
    this.Round   = {};
    this.Hokm    = null;
    this.Draw    = {};
  }
}
class Server extends colyseus.Room {
  constructor (options) {
    super(options);
    this.refUrl = inDev ? devSrv :fnlSrv;
    this.timing = 15000;
    this.confirm;
    this.callBack;
    this.pass;
    this.startType;
    this.regnant;
    this.turn;
    this.throws;
    this.deck ;
    this.stack;
    this.winner;
    this.userDeck;
    this.first = true;

    this.autoHokm = this.autoHokm.bind(this);
    this.autoThrow = this.autoThrow.bind(this);
    this.checkStart = this.checkStart.bind(this);
    this.checkOption = this.checkOption.bind(this);
  }
  onInit (options) {
    this.meta     = {};
    this.deck  = Array(52).fill().map((e,i)=>i+1);
    this.setState(new State);
    if(inDev){
      this.Count = 1;
      this.Names = ['','Siavash','Meysam'];
    }
  }
  requestJoin (options, isNewRoom) {
    if(options.create && isNewRoom){
      this.meta = new metaData(options.data);
      this.setMetadata(this.meta);
    }
    return (options.create)
    ? (options.create && isNewRoom)
    : this.clients.length > 0;
  }
  onAuth (options){
    var info = En(options.info);
    var data = JSON.parse(info);

    var passed = data.s > 0;

    if(passed){
      return data
    }
    return false;
    
  }
  onJoin (client, options, auth) {
    if(this.first){
      this.meta.creator = auth.n; 
      this.meta.creatorId = auth.i ;
      this.setMetadata(this.meta);
    }
    this.first = false;

    this.addPlayer(client,options.key,auth);
    this.checkJoinRules(client);
    this.send(client,{welcome:this.meta});
    this.syncState(client);
  }

  onMessage (client, message) {
    var type = Object.keys(message)[0];
    var value = message[type];
    switch(type)
    {
      case 'sit':
        if(this.sit(client,value))
          this.send(client,{mySit:value});
      break;
      case 'bot':
        this.addBot(client);
      break;
      case 'stand':
        if(!this.state.Started)
          this.stand(client);
      break;
      case 'cancel':
        if(this.state.Started && client.cancel == null)
          this.cancel(client);
      break;
      case 'confirm':
        this.readyConfirm(client,value);
      break;
      case 'hokm':
      if(this.regnant == client.sit && this.state.Hokm == null)
      {
        this.hokmTaked(value)
      }
      break;
      case 'option':
      if(this.userDeck[client.sit].length > 13)
      {
        this.validateOption(client.sit,value);
      }
      break;
      case 'throw':
      if(this.turn == client.sit)
      {
        this.throw(value,client);
      }
      break;
    }
  }

  onLeave (client,consented) {
    if(this.state.Started ){
      if(consented){
        this.stand(client);
        this.leave(client);
      }else{
        
      }
    }else{
      this.stand(client);
    }
  }
  onDispose () { 
    
  }

// ***************************************************** \\
  addPlayer(client,key,data) {
    if(inDev){
      client.name  = this.Names[this.Count];
      client.id    = this.Count;
      this.Count++;
    }
    else{
      client.id    = data.i;
      client.name  = data.n;
    }
    client.key   = key;
    client.sit   = 0;

    // var player = new Player(client,data)
    // if (this.Players.push(player)) {
    //     return player
    // } else {
    //     return false
    // }
  }
  checkJoinRules(client){
    var i;
    for(i in this.clients){
      if(this.clients[i].id == client.id && client.sessionId != this.clients[i].sessionId ){
        this.clients[i].close();
      }
    }
  }
  syncState(client){
    var key='',data = {};
    for(var i in this.state){
      if(typeof this.state[i] == 'object'){
        for(var j in this.state[i]){
          key = i+'/'+j;
          data = {};
          data[key] = this.state[i][j];
          this.send(client,data);
        }
      }else{
        data = {};
        data[i] = this.state[i];
        this.send(client,data);
      }
    }
  }
  sit(client,id){
    if(this.state.Sit[id] == null)
    {
      this.stand(client);
      client.sit = id; 
      this.state.Sit[id] = {id:client.id,name:client.name};
      this.setClientReady(); 
      this.canStart();
      return true;
    }
    return false;
  }
  stand(client){
    if(client.sit > 0)
    {
      delete this.state.Sit[client.sit];
      var bot = this.myPartner(client);
      if(this.state.Sit[bot] != null && this.state.Sit[bot].bot != null)
      {
        delete this.state.Sit[bot];
      }
      this.setClientReady();
    }
  }
  canStart(){
    if(this.timer != undefined)
      this.timer.clear();
    this.timer = this.clock.setTimeout(()=>{
      if(this.meta.ready == this.meta.player){
        this.callBack = this.checkStart;
        this.makeConfirm({canStart:true},true);
      }
    },2000);
  }
  checkStart(type,data){
    if(this.pass){
      switch(type){
        case 'no':
          this.clearTimer();
          this.pass = false;
          this.stand(data);
        break;
        case 'yes':
          if(data == this.meta.player){
            this.clearTimer();
            this.pass = false;
            this.started();
          }
        break;
        default:
          this.pass = false;
          var i,sit;
          for(i in this.state.Sit){
            if(this.confirm[i] == false){
              sit = this.clientBySit(i);
              this.stand(this.clients[sit])
            }
          }
        break;
      }
    }
  }
  cancel(client){
    this.canceler = client.id;
    this.callBack = this.checkCancel;
    this.makeConfirm({canCancel:client.name},false);
  }
  checkCancel(type,data){
    if(this.pass){
      switch(type){
        case 'no':
          delete this.canceler;
          this.pass = false;
        break;
        case 'yes':
          if(data == this.meta.player){
            this.pass = false;
            this.gameCanceled();
            this.resetGame();
            delete this.canceler;
          }
        break;
      }
    }
  }
  gameCanceled(){
    var i,sit,id,bot=0,users={};
    for(i in this.state.Sit){
      sit = this.clientBySit(i);
      if( sit == -1){
        bot++;
      }
      else{
        id = this.clients[sit].id;
        users[id] = this.canceler == id ? 1 : 0;
      }
    }
    if(bot>0 && this.meta.player==2){
      //return;
    }
    var data = {action:'cancel',room:this.meta,data:users};
    this.data2server(data)
  }
  data2server(data){
    data.type = 'hokm';
    request.post({url:this.refUrl, form: data}, function(err,httpResponse,body){
      console.log(body);
     })

  }
  makeConfirm(message,needCheck){
    this.confirm = {};
    this.pass = true;
    var i,sit;
    for(i in this.state.Sit){
      sit = this.clientBySit(i);
      this.confirm[i] = sit == -1;
      if(sit > -1){
        this.send(this.clients[sit],message);
      }
    }
    if(needCheck)
      this.setTimer(this.callBack,this.timing);
  }
  readyConfirm(client,confirm){
    if(confirm){
      this.confirm[client.sit] = true;
      var count = 0,i;
      for(i in this.state.Sit){
        if(this.confirm[i] == true)
          count++;
      }
      this.callBack('yes',count);
    }else{
      this.callBack('no',client);
    }
  }
  clientBySit(id){
    var ret = -1,i;
    for(i in this.clients){
      if(this.clients[i].sit == id){
        ret = i;
        break;
      }
    }
    return ret;
  }
  setClientReady(){
    this.meta.ready = Object.keys(this.state.Sit).length;
    this.setMetadata(this.meta);
  }
  random(min,max){
    return Math.floor(Math.random() * max)+min; 
  }
  shuffle(){
    var a,b,c;
    for (a = 0; a < 10; a++) {
      for (b = this.deck.length - 1; b > 0; b--) {
          c = Math.floor(Math.random() * (b + 1));
          [this.deck[b], this.deck[c]] = [this.deck[c], this.deck[b]];
      }
    }
  }
  chunk(){
    var size = this.deck.length / this.meta.player;
    var i,start,end;
    for(i=0;i<this.meta.player;i++){
      start = i*size;
      end = start+size;
      this.userDeck[i+1] = this.deck.slice(start, end);
    }
  }
  setTimer(callBack,timing){
    this.timer = this.clock.setTimeout(()=>callBack(true),timing);
    var tm = timing/1000;
    this.state.Timer = tm;
    // this.broadcast({Timer:tm});
  }
  clearTimer(){
    if(this.timer != undefined){
      this.timer.clear();
    this.state.Timer = null;
      //this.broadcast({Timer:null});
    }
  }
  
  //*****************************Hokm******************* \\
  addBot(client){
    if(client.sit > 0)
    {
        var bot = this.myPartner(client);
        if(this.state.Sit[bot] != null && this.state.Sit[bot].bot != null){
          delete this.state.Sit[bot];
        }
        else if(this.sit({name:'Bot',id:0,sit:0},bot)){
          this.state.Sit[bot].sit = bot;
          this.state.Sit[bot].bot = true;
        }
    }
  }
  isBot(sit){
    if(this.state.Sit[sit].bot == null)
      return false;
    return this.state.Sit[sit].bot == true;
  }
  randomRegnant(){
    return this.random(1,this.meta.player);
  }
  started(){
    this.state.Started = true;
    this.regnant  = this.randomRegnant();
    this.state.Point = {1:0,2:0};
    this.state.Round = {1:0,2:0};
    this.newRound();
  }
  newRound(){
    this.turn = this.regnant ;
    this.userDeck = {};
    this.startType = null;
    this.resetTable();
    this.state.Sit[this.regnant].crown = true;
    this.shuffle();
    this.chunk();
    this.clock.setTimeout(() =>this.takeHokm(),1000);
  }
  newPoint(){
    var who = this.winner[0];
    var winner = this.winnerTeam();
    this.state.Point[winner]++;
    this.state.Draw = {};
    this.winner = [];
    if(this.state.Point[winner] == 7){
      var loser = winner == 2 ? 1 : 2;
      var plus = 1;
      if(this.state.Point[loser] == 0){
        if(winner == this.regnantTeam() )
          plus = 2;
        else
          plus = 3;
      }
      this.state.Round[winner] += plus;
      if(this.state.Round[winner] >= this.meta.round){
        this.gameDone();
      }
      else{
        if(winner != this.regnantTeam() )
          this.regnant = this.nextSit(this.regnant); 
        this.state.Point = {1:0,2:0};
        this.newRound();
      }
    }
    else{
      this.turn = who;
      this.startType = null;
      this.next();
    }
  }
  next(){
    var tmp = this.turn;
    this.turn = 0;
    this.resetTurn();
    if(this.LastHand()){
      this.clock.setTimeout(() => this.newPoint(),1000);
    }
    else{
      setTimeout(() => {
        this.turn = tmp;
        if( this.startType != null)
        {
          this.turn = this.nextSit(this.turn);
        }
        this.state.Sit[this.turn].turn = true;
        if(this.isBot(this.turn)){
          //this.clock.setTimeout(() => this.autoThrow(),500);
          this.autoThrow();
        }
        else{
          var clnt = this.clientBySit(this.turn);
          this.send(this.clients[clnt],{Move:this.startType}); 
          this.setTimer(this.autoThrow,this.timing);
        }
      }, 500); 
    }
  }
  resetCrown(){
    var i;
    for(i in this.state.Sit){
      if(this.state.Sit[i].crown == true){
        this.state.Sit[i].crown = false;
      }
    }
  }
  resetTurn(){
    var i;
    for(i in this.state.Sit){
      if(this.state.Sit[i].turn == true){
        this.state.Sit[i].turn = false;
      }
    }
  }
  leave(){
    this.resetGame();
  }
  resetScore(){
    this.state.Point = {};
    this.state.Round = {};
  }
  resetGame(){
    this.state.Started = false;
    this.resetTable(true);
    this.canStart();
  }
  resetTable(info){
    if(info == true)
      this.resetScore();
    this.resetCrown();
    this.resetTurn();
    this.state.Hokm  = null;
    this.clearTimer();
    this.state.Draw = {};
    this.stack = {};
    this.state.Timer = null;
  }
  //************  Order *****************//
  readyCards(arr){
    var j,k,v,stack=[[],[],[],[]];
    for (j of arr) {
      if(typeof j == 'number'){
        k = Math.ceil(j/13)-1;
        v = j%13;
        v = v == 0 ? 13:v;
      }
      else{
        [k,v] = j;
      }
      stack[k].push(v);
    }
    return stack;
  }
  readyOption(arr){
    var j,k,v,stack=[];
    for (j of arr) {
      k = Math.ceil(j/13)-1;
      v = j%13;
      v = v == 0 ? 13:v;
      stack.push([k,v]);
    }
    return stack;
  }
  takeHokm(){
    if(this.isBot(this.regnant)){
      this.autoHokm();
    }
    else{
      var reg = this.clientBySit(this.regnant);
      var cards = this.readyCards(this.userDeck[this.regnant].slice(0, 5));
      this.send(this.clients[reg],{Choose:cards}); 
      this.setTimer(this.autoHokm,this.timing);
    }
  }
  hokmTaked(value){
    this.state.Hokm = value ;
    this.clearTimer();
    if(this.meta.player == 4)
      this.dispatch();
    else
      this.takeOption();
  }
  takeOption(){
    var i,sit;
    for(i in this.state.Sit){
      sit = this.clientBySit(i);
      this.userDeck[i] = this.readyOption(this.userDeck[i]);
      if(sit > -1){
        this.send(this.clients[sit],{Option:this.userDeck[i] });
        this.setTimer(this.checkOption,2*this.timing);
      }else{
        this.autoOption(i);
      }
    }
  }
  validateOption(sit,cards){
    var card,stack,match;
    for(card of cards){
      match = false;
      for(stack of this.userDeck[sit]){
        if(card[0] == stack[0] && card[1] == stack[1]) 
          match = true;
      }
      if(match == false){
        break;
      }
    }
    if(match == false){
      this.autoOption(sit);
    }
    else{
      this.userDeck[sit] = cards;
    }
    this.checkOption();
  }
  checkOption(done){
    var i,sit,start = true;
    for(i in this.state.Sit){
      sit = this.clientBySit(i);
      if(sit > -1 && this.userDeck[i].length > 13 ){
        if(done == true)
          this.autoOption(i);
        else 
          start= false;
      }
    }

    if(start){
      this.clearTimer();
      this.dispatch();
    }
  }
  dispatch(){
    var i,sit;
    for(i in this.state.Sit){
      sit = this.clientBySit(i);
      this.userDeck[i] = this.userDeck[i].sort((a, b)=>{return a-b})
      this.stack[i] = this.readyCards(this.userDeck[i]);
      if(sit > -1){
        this.send(this.clients[sit],{Cards:this.stack[i]});
      }
    }
    this.next();
  }
  throw(card,client){
    var [type,val] = card;
    if(this.stack[this.turn][type].indexOf(val) > -1){
      if(this.startType != null){
        if(this.ihaveCard(this.startType) &&  type != this.startType){
            if(client != null)
              this.send(client,{inValid:true});
            return false;
        }
      }
      this.clearTimer();
      if(this.startType == null){
        this.startType = type;
        this.winner = [this.turn,type,val];
      }
      else{
        if(type == this.winner[1]){
          if(val > this.winner[2])
            this.winner = [this.turn,type,val];
        }
        else if(type == this.state.Hokm){
          this.winner = [this.turn,type,val];
        }
      }
      this.removeFromCards(card);
      this.state.Draw[this.turn] = card;
      this.next();    
      //this.clock.setTimeout(() => this.next(),500);
      
    }
    else{
      console.log(this.stack);
      console.log('nocard :'+card);
      console.log('turn :'+this.turn);
    }
  }
  removeFromCards(card){
    var [type,val] = card;
    var index = this.stack[this.turn][type].indexOf(val);
    if(index !== -1) 
    this.stack[this.turn][type].splice(index, 1);
  }

  //**************** Auto ******************\\

  autoOption(sit){
    var i,card,stack=[];
    for(i=0;i<this.userDeck[sit].length;i+=2){
      card = this.userDeck[sit][i];
      if(card[0] == this.state.Hokm){
        stack.push(card);
      }
      else if(card[1]>11){
        stack.push(card);
      }
      else{
        stack.push(this.userDeck[sit][i+1]);
      }
    }
    this.userDeck[sit] = stack;
  }
  autoHokm(){
    var j,deck = this.readyCards( this.userDeck[this.regnant].slice(0, 5));
    var hokm = -1;
    for (j=0;j<4 ;j++) {
      if(deck[j]!=null && deck[j].length > hokm){
        hokm = j;
      }
    }
    this.hokmTaked(hokm)
  }
  autoThrow(){
    if(this.meta.player == 2)
      this.autoThrow2();
    else 
      this.autoThrow4();
  }
  autoThrow4(){
    var ret,tmp,rutin=false;
    if(this.imFirst()){
      ret = this.maxHand();
    }
    else if(this.imSecond()){
      rutin = 1;
    }
    else if(this.imThird()){
      if(this.myPartner(this.state.Sit[this.turn]) == this.winner[0])
      {
        if(this.winner[2] > 10){
          if(this.ihaveCard(this.startType)){
            tmp  = this.minOf(this.startType);
            ret = [this.startType,tmp] ;
          }else{
            ret = this.minHand();
          }
        }
        else{
          rutin = 1;
        }
      }
      else{
        rutin = 2;
      }
    }
    else{
      rutin = 1;
    }


    if(rutin){
      if(this.ihaveCard(this.startType)){
        if(rutin == 1){
          tmp  = this.moreThen(this.startType,this.winner[2]);
          tmp  = tmp > 0 ? tmp : this.minOf(this.startType);
        }
        else{
          tmp  = this.maxOf(this.startType);
        }
        ret = [this.startType,tmp] ;
      }
      else if(this.ihaveCard(this.state.Hokm) && this.state.Hokm != this.startType){
        tmp  =  this.minOf(this.state.Hokm);
        ret = [this.state.Hokm,tmp] ;
      }
      else{
        ret = this.minHand();
      }
    }
    this.throw(ret);
  }
 autoThrow2(){
    var ret,tmp;
    if(this.imFirst()){
      ret = this.maxHand();
    }
    else{
      if(this.ihaveCard(this.startType)){
        tmp  = this.moreThen(this.startType,this.winner[2]);
        tmp  = tmp > 0 ? tmp : this.minOf(this.startType);
        ret = [this.startType,tmp] ;
      }
      else if(this.ihaveCard(this.state.Hokm) && this.state.Hokm != this.startType){
        tmp  =  this.minOf(this.state.Hokm);
        ret = [this.state.Hokm,tmp] ;
      }
      else{
        ret = this.minHand();
      }
      
    }
    this.throw(ret);
  }

  regnantTeam(){
    return this.regnant > 2 ? this.regnant-2:this.regnant;
  }
  winnerTeam(){
    return this.winner[0] > 2 ? this.winner[0]-2:this.winner[0];
  }
  myPartner(client){
    var half = this.meta.player / 2;
    return client.sit > half ? client.sit-half : client.sit + half;
  }
  LastHand(){
    return (this.meta.player == Object.keys(this.state.Draw).length);
  }
  nextSit(turn){
    turn ++;
    if(turn > this.meta.player)
      turn = 1;
    return turn;
  }
  cartType(card){
    return Math.ceil(card/13)-1;
  }
  ihaveCard(type){
    if(type == null)
      return this.userDeck[this.turn].length;
    return this.stack[this.turn][type].length > 0;
  }
  myPoint(i){
    var p = i >2 ? i-2:i;
    return this.state.point[p] == i;
  }
  isFirstHand(){
    return this.state.Point[1] == 0 && this.state.Point[2] == 0;
  }
  ihavePartneer(){
    return this.meta.player == 4;
  }
  imFirst(){
    return this.startType == null;
  }
  imSecond(){
    return ((this.meta.player-3) == (Object.keys(this.state.Draw).length));
  }
  imThird(){
    return ((this.meta.player-2) == (Object.keys(this.state.Draw).length));
  }
  imLast(){
    return ((this.meta.player-1) == (Object.keys(this.state.Draw).length));
  }
  moreThen(type,max){
    var i,more=0;
    for (i of this.stack[this.turn][type]) {
      if(i>max){
        more = i;
        break;
      }
    }
    return more;
  }
  maxOf(type){
    var i,max=0,count=-1;
    for (i of this.stack[this.turn][type]) {
      count++;
      if(i>max){
        max = i;
      }
    }
    return max;
  }
  maxHand(){
    var i,j,max=0,type,count=-1;
    for (i of this.stack[this.turn]) {
      count++;
      for(j of i) {
        if(j>max){
          max = j;
          type = count;
        }
      }
    }
    return [type,max];
  }
  minOf(type){
    var i,min=15,count=-1;
    for (i of this.stack[this.turn][type]) {
      count++;
      if(i<min){
        min = i;
      }
    }
    return min;
  }
  minHand(){
    var i,j,min=15,type,count=-1;
    for (i of this.stack[this.turn]) {
      count++;
      for(j of i) {
        if(j<min){
          min = j;
          type = count;
        }
      }
    }
    return [type,min];
  }
}



module.exports = Server;