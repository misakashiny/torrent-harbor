#!/usr/bin/env python3
"""Host-side updater. The web container never receives the Docker socket."""
import argparse,datetime,gzip,hashlib,http.client,json,os,pathlib,platform,re,shutil,sqlite3,subprocess,tarfile,time,urllib.request,urllib.error,urllib.parse,uuid

VERSION=re.compile(r'^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$')
ACTIVE={'queued','downloading','verifying','backing-up','installing','checking','rolling-back'}
def atomic_json(path,value,mode=0o644):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False));os.chmod(temp,mode);os.replace(temp,path)
def load_json(path,fallback=None):
    try:return json.loads(pathlib.Path(path).read_text())
    except (OSError,ValueError):return fallback
def validate_tag(tag):
    match=VERSION.fullmatch(str(tag))
    if not match:raise ValueError('Invalid release version')
    return match.group(1)
def validate_repository(repo):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}',str(repo)):raise ValueError('Invalid repository')
    return repo
class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        validate_download_url(newurl,redirect=True)
        return super().redirect_request(req,fp,code,msg,headers,newurl)
def validate_download_url(url,redirect=False):
    parsed=urllib.parse.urlsplit(url);host=parsed.hostname or ''
    allowed=host in ['github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'] or (redirect and host.endswith('.githubusercontent.com'))
    if parsed.scheme!='https' or parsed.username or parsed.password or not allowed:raise ValueError('Unexpected update download host')
    return url
def validate_image_archive(path,expected_tag):
    with tarfile.open(path,'r:gz') as archive:
        member=archive.getmember('manifest.json')
        if member.size>1024*1024:raise ValueError('Image manifest too large')
        manifests=json.load(archive.extractfile(member))
        if not isinstance(manifests,list) or len(manifests)!=1:raise ValueError('Expected one application image')
        if manifests[0].get('RepoTags')!=[expected_tag]:raise ValueError('Unexpected image name in release archive')
    return True
def command(args,timeout=180):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Command failed: '+args[0]+' '+(' '.join(args[1:3]))+'; '+result.stderr.strip()[-800:])
    return result.stdout.strip()

class Updater:
    def __init__(self,config):
        self.config=config;self.repository=validate_repository(config['repository'])
        self.root=pathlib.Path(config['root']).resolve();self.state=pathlib.Path(config['stateDir']).resolve();self.data=pathlib.Path(config['dataDir']).resolve()
        self.compose=pathlib.Path(config['compose']).resolve();self.override=self.root/'update-image.yaml'
        self.project=config.get('project','torrent-harbor');self.container=config.get('container','torrent-harbor')
        if self.compose.parent!=self.root:raise ValueError('Compose must belong to the deployment directory')
        if not re.fullmatch(r'[a-z0-9-]+',self.project) or not re.fullmatch(r'[a-z0-9-]+',self.container):raise ValueError('Invalid managed application identity')
        self.platform='linux-arm64' if platform.machine() in ['aarch64','arm64'] else 'linux-amd64'
        self.journal=load_json(self.root/'updater-journal.json',{'handled':[],'previous':None})
        self.opener=urllib.request.build_opener(SafeRedirect())
        self.state.mkdir(parents=True,exist_ok=True)
    def status(self,job,state,message,**extra):
        atomic_json(self.state/'status.json',{'id':job['id'],'state':state,'message':message,'action':job.get('action'),'tag':job.get('tag'),'time':int(time.time()*1000),**extra})
    def heartbeat(self):
        previous=self.journal.get('previous')
        atomic_json(self.state/'agent.json',{'repository':self.repository,'heartbeat':int(time.time()*1000),'previousVersion':previous.get('version') if previous else None,'platform':self.platform,'recoveryNeeded':bool(self.journal.get('pending'))})
    def assert_identity(self):
        item=json.loads(command(['docker','inspect',self.container]))[0]
        mount=next((m for m in item['Mounts'] if m['Destination']=='/app/data'),None)
        state=next((m for m in item['Mounts'] if m['Destination']=='/app/updates'),None)
        if not mount or pathlib.Path(mount['Source']).resolve()!=self.data:raise ValueError('Managed data volume changed')
        if not state or pathlib.Path(state['Source']).resolve()!=self.state:raise ValueError('Managed update volume changed')
        return item
    def assert_idle(self):
        con=sqlite3.connect('file:'+str(self.data/'harbor.sqlite')+'?mode=ro',uri=True,timeout=5)
        try:
            def kv(key):
                row=con.execute('SELECT value FROM kv WHERE key=?',(key,)).fetchone();return json.loads(row[0]) if row else None
            if (kv('settings') or {}).get('controlEnabled') or kv('managed'):raise ValueError('请先释放接管，再执行版本更新')
        finally:con.close()
    def fetch_bytes(self,url,limit=1024*1024):
        validate_download_url(url)
        headers={'User-Agent':'TorrentHarborUpdater/1.1','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}
        def receive():
            with self.opener.open(urllib.request.Request(url,headers=headers),timeout=30) as response:return response.read(limit+1)
        data=self.retry_network(receive)
        if len(data)>limit:raise ValueError('Update metadata too large')
        return data
    def retry_network(self,operation):
        for attempt in range(3):
            try:return operation()
            except (OSError,http.client.HTTPException) as error:
                if isinstance(error,urllib.error.HTTPError) and error.code<500 and error.code!=429:raise
                if attempt==2:raise
                self.heartbeat();time.sleep(attempt+1)
    def download(self,job):
        version=validate_tag(job['tag']);tag='v'+version
        release=json.loads(self.fetch_bytes(f'https://api.github.com/repos/{self.repository}/releases/tags/{tag}'))
        if release.get('draft') or release['id']!=job.get('releaseId') or release['tag_name']!=tag:raise ValueError('Release metadata changed after confirmation')
        expected=f'torrent-harbor-{version}-{self.platform}.tar.gz'
        assets={a['name']:a for a in release.get('assets',[])}
        if expected not in assets or expected+'.sha256' not in assets:raise ValueError('当前架构的安装包或校验文件缺失')
        prefix=f'https://github.com/{self.repository}/releases/download/{tag}/'
        for a in [assets[expected],assets[expected+'.sha256']]:
            if not a['browser_download_url'].startswith(prefix):raise ValueError('Release asset does not belong to the pinned repository')
        published=assets[expected].get('digest')
        # GitHub computes this digest from the uploaded asset. Prefer the
        # authenticated HTTPS API value so a cache hit needs no CDN round trip.
        if isinstance(published,str) and re.fullmatch(r'sha256:[a-f0-9]{64}',published):checksum=published[7:]
        else:checksum=self.fetch_bytes(assets[expected+'.sha256']['browser_download_url'],4096).decode('ascii').split()[0].lower()
        if not re.fullmatch(r'[a-f0-9]{64}',checksum):raise ValueError('Checksum file is invalid')
        size=assets[expected]['size']
        if not 0<size<350*1024*1024:raise ValueError('Release image size is outside the supported range')
        cache=self.root/'update-cache';cache.mkdir(exist_ok=True)
        path=cache/expected;temp=cache/(expected+'.part')
        request=urllib.request.Request(assets[expected]['browser_download_url'],headers={'User-Agent':'TorrentHarborUpdater/1.1'})
        try:
            cached=False
            if path.is_file() and path.stat().st_size==size:
                digest=hashlib.sha256()
                with path.open('rb') as file:
                    for chunk in iter(lambda:file.read(1024*1024),b''):digest.update(chunk)
                cached=digest.hexdigest()==checksum
            if not cached:
                def receive_image():
                    digest=hashlib.sha256();received=0
                    self.status(job,'downloading','正在下载 GitHub 发布镜像',received=0,total=size)
                    with self.opener.open(request,timeout=45) as response,temp.open('wb') as file:
                        last=0
                        while True:
                            chunk=response.read(1024*1024)
                            if not chunk:break
                            received+=len(chunk)
                            if received>size:raise ValueError('Release image is larger than its published size')
                            file.write(chunk);digest.update(chunk)
                            if time.time()-last>1:self.status(job,'downloading','正在下载 GitHub 发布镜像',received=received,total=size);self.heartbeat();last=time.time()
                    if received!=size or digest.hexdigest()!=checksum:raise ValueError('安装包 SHA-256 校验失败')
                self.retry_network(receive_image)
            if published and published!='sha256:'+checksum:raise ValueError('GitHub 摘要与校验文件不一致')
            self.status(job,'verifying','正在校验缓存镜像身份与架构' if cached else '正在校验镜像身份与架构',cacheUsed=cached)
            validate_image_archive(path if cached else temp,'torrent-harbor:'+version)
            if not cached:os.replace(temp,path)
            command(['docker','image','load','-i',str(path)],timeout=180)
            image=json.loads(command(['docker','image','inspect','torrent-harbor:'+version]))[0]
            wanted='arm64' if self.platform.endswith('arm64') else 'amd64'
            if image['Architecture']!=wanted or image['Os']!='linux' or image['Config'].get('User') not in ['node','1000','1000:1000']:raise ValueError('镜像平台或运行用户不符合应用要求')
            return {'version':version,'image':image['Id']}
        finally:
            if temp.exists():temp.unlink()
    def current(self):
        item=self.assert_identity()
        version=json.loads(urllib.request.urlopen(self.config.get('healthUrl','http://127.0.0.1:8787/api/health'),timeout=5).read())['version']
        validate_tag(version)
        return {'image':item['Image'],'version':version}
    def save_override(self,image):
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',image):raise ValueError('Invalid application image ID')
        self.override.write_text('services:\n  torrent-harbor:\n    image: '+image+'\n    pull_policy: never\n')
        os.chmod(self.override,0o600)
    def start(self,image):
        self.save_override(image)
        command(['docker','compose','-p',self.project,'-f',str(self.compose),'-f',str(self.override),'up','-d','--no-build','--pull','never','torrent-harbor'],timeout=90)
    def stop(self):
        try:command(['docker','stop','--time','20',self.container],timeout=35)
        except RuntimeError as error:
            if not any(text in str(error).lower() for text in ['no such container','no such object']):raise
    def healthy(self,version,timeout=75):
        deadline=time.time()+timeout
        while time.time()<deadline:
            try:
                self.heartbeat()
                data=json.loads(urllib.request.urlopen(self.config.get('healthUrl','http://127.0.0.1:8787/api/health'),timeout=3).read())
                item=self.assert_identity()
                if data.get('ok') and data.get('version')==version and item['State'].get('Health',{}).get('Status')=='healthy':return True
            except Exception:pass
            time.sleep(2)
        return False
    def backup(self,job,current):
        directory=self.root/'backups'/'updates'/job['id'];directory.mkdir(parents=True,mode=0o700)
        os.chmod(directory,0o700)
        target=directory/'data';target.mkdir()
        command(['cp','-a',str(self.data)+'/.',str(target)],timeout=90)
        snapshot={**current,'backup':str(directory),'time':int(time.time()*1000)}
        atomic_json(directory/'snapshot.json',snapshot,0o600)
        return snapshot
    def restore_data(self,snapshot):
        source=pathlib.Path(snapshot['backup']).resolve()/'data'
        if not source.parent.is_relative_to((self.root/'backups'/'updates').resolve()) or not source.is_dir():raise ValueError('Rollback snapshot is unavailable')
        if self.config.get('dataVolume'):
            volume=json.loads(command(['docker','volume','inspect',self.config['dataVolume']]))[0]
            if pathlib.Path(volume['Mountpoint']).resolve()!=self.data:raise ValueError('Managed data volume changed')
        else:self.assert_identity()
        for path in self.data.iterdir():
            if path.is_symlink() or path.is_file():path.unlink()
            elif path.is_dir():
                if not path.resolve().is_relative_to(self.data):raise ValueError('Unsafe data directory')
                shutil.rmtree(path)
        command(['cp','-a',str(source)+'/.',str(self.data)],timeout=90)
    def execute(self,job):
        if self.journal.get('pending'):raise RuntimeError('存在待恢复的版本操作，请先检查主机更新服务日志并重启执行器')
        if not re.fullmatch(r'[a-f0-9-]{36}',str(job.get('id',''))):raise ValueError('Invalid update job')
        if job.get('repository','').lower()!=self.repository.lower():raise ValueError('Update source differs from the host-pinned repository')
        if not 0<=time.time()*1000-job.get('requestedAt',0)<600000:raise ValueError('Update request expired')
        if job.get('action') not in ['update','rollback']:raise ValueError('Invalid update action')
        validate_tag(job['tag']);self.assert_identity();self.assert_idle()
        old=self.current();rollback=self.journal.get('previous')
        candidate=self.download(job) if job['action']=='update' else rollback
        if not candidate or (job['action']=='rollback' and candidate['version']!=validate_tag(job['tag'])):raise ValueError('Requested rollback snapshot is not available')
        command(['docker','image','inspect',candidate['image']])
        self.assert_idle();self.status(job,'backing-up','正在停止应用并备份更新前数据')
        self.journal['pending']={'job':job,'old':old,'backup':None}
        atomic_json(self.root/'updater-journal.json',self.journal,0o600)
        self.stop()
        backup=None
        try:
            backup=self.backup(job,old)
            self.journal['pending']['backup']=backup
            atomic_json(self.root/'updater-journal.json',self.journal,0o600)
            if job['action']=='rollback':self.restore_data(candidate)
            self.status(job,'installing','正在切换应用版本')
            self.start(candidate['image']);self.status(job,'checking','正在检查新版健康状态')
            if not self.healthy(candidate['version']):raise RuntimeError('新版未通过健康检查')
            self.journal['previous']=backup
            self.journal.pop('pending',None)
            atomic_json(self.root/'updater-journal.json',self.journal,0o600)
            self.status(job,'succeeded','版本操作完成',version=candidate['version'],previousVersion=old['version'])
        except Exception as error:
            self.status(job,'rolling-back','操作失败，正在恢复原版本与数据')
            try:
                self.stop()
                if backup:self.restore_data(backup)
                self.start(old['image'])
                if not self.healthy(old['version']):raise RuntimeError('Original version recovery did not pass health check')
                self.status(job,'failed','更新失败，已恢复原版本与数据：'+str(error),restoredVersion=old['version'])
                self.journal.pop('pending',None)
                atomic_json(self.root/'updater-journal.json',self.journal,0o600)
            except Exception as recovery:self.status(job,'recovery-needed','自动恢复未完成，请查看主机更新日志：'+str(recovery))
            raise
    def recover_interrupted(self):
        pending=self.journal.get('pending')
        if not pending:return
        job=pending['job'];old=pending['old']
        self.status(job,'rolling-back','检测到中断的版本操作，正在恢复更新前版本')
        try:
            self.stop()
            if pending.get('backup'):self.restore_data(pending['backup'])
            self.start(old['image'])
            if not self.healthy(old['version']):raise RuntimeError('Interrupted update recovery failed health check')
            self.journal.pop('pending',None)
            atomic_json(self.root/'updater-journal.json',self.journal,0o600)
            self.status(job,'failed','上次版本操作中断，已恢复原版本与数据',restoredVersion=old['version'])
        except Exception as error:
            self.status(job,'recovery-needed','中断恢复未完成：'+str(error))
            raise
    def loop(self):
        self.recover_interrupted()
        while True:
            self.heartbeat();job=load_json(self.state/'request.json')
            if job and job.get('id') not in self.journal.get('handled',[]):
                self.journal.setdefault('handled',[]).append(job.get('id'));self.journal['handled']=self.journal['handled'][-100:]
                atomic_json(self.root/'updater-journal.json',self.journal,0o600)
                try:self.execute(job)
                except Exception as error:
                    previous=load_json(self.state/'status.json',{})
                    if previous.get('id')!=job.get('id') or previous.get('state') not in ['failed','recovery-needed']:self.status(job,'failed',str(error))
            time.sleep(3)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    Updater(json.loads(pathlib.Path(args.config).read_text())).loop()
