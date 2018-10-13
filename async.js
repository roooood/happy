async onAuth (options){
    var data = { action:'auth',key:options.key};
    if(this.first){
      data['room'] = this.meta;
    }
    const response = await request.get(this.refUrl).query(data);
    var data = JSON.parse(response.res.text);
    var passed = data.type == 'ok';

    this.first = false;

    if(passed){
      if(this.meta.creator == null ){
        this.meta.creator = data.name ; 
        this.meta.creatorId = data.id ;
        this.setMetadata(this.meta);
        return data;
      }
      return data
    }
    return false;
    
  }