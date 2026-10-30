import importlib.util, unittest, tempfile, pathlib, json, tarfile, io, time, hashlib, urllib.error
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('harbor_updater',pathlib.Path(__file__).resolve().parents[1]/'tools'/'harbor-updater.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class UpdaterTests(unittest.TestCase):
    def test_download_identity(self):
        for url in ['http://github.com/x','https://github.com.evil.example/x','https://github.com@evil.example/x','https://127.0.0.1/x']:
            with self.assertRaises(ValueError):mod.validate_download_url(url)
        self.assertEqual(mod.validate_tag('v1.1.0-rc.1'),'1.1.0-rc.1')
        with self.assertRaises(ValueError):mod.validate_tag('../1.1.0')
    def test_image_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            path=pathlib.Path(temp)/'image.tar.gz'
            with tarfile.open(path,'w:gz') as archive:
                payload=json.dumps([{'RepoTags':['torrent-harbor:1.1.0']}]).encode();item=tarfile.TarInfo('manifest.json');item.size=len(payload);archive.addfile(item,io.BytesIO(payload))
            self.assertTrue(mod.validate_image_archive(path,'torrent-harbor:1.1.0'))
            with self.assertRaises(ValueError):mod.validate_image_archive(path,'other:latest')
    def make_agent(self,root):
        updater=mod.Updater({'root':str(root),'compose':str(root/'compose.yaml'),'stateDir':str(root/'state'),'dataDir':str(root/'data'),'repository':'owner/repo'})
        updater.assert_identity=lambda:{};updater.assert_idle=lambda:None;updater.current=lambda:{'image':'old','version':'1.0.0'}
        updater.download=lambda job:{'image':'new','version':'1.1.0'}
        updater.backup=lambda job,old:{**old,'backup':str(root/'backup')}
        return updater
    def job(self):return {'id':'01234567-0123-0123-0123-012345678901','repository':'owner/repo','tag':'v1.1.0','action':'update','requestedAt':time.time()*1000}
    @patch.object(mod.time,'sleep')
    def test_network_retry_does_not_retry_permanent_http_errors(self,sleep):
        with tempfile.TemporaryDirectory() as temp:
            updater=self.make_agent(pathlib.Path(temp));calls=[]
            def receive():
                calls.append(1)
                if len(calls)==1:raise urllib.error.URLError('TLS EOF')
                return b'valid'
            self.assertEqual(updater.retry_network(receive),b'valid');self.assertEqual(len(calls),2)
            calls.clear()
            def forbidden():calls.append(1);raise urllib.error.HTTPError('https://api.github.com/',403,'Forbidden',{},None)
            with self.assertRaises(urllib.error.HTTPError):updater.retry_network(forbidden)
            self.assertEqual(len(calls),1)
    @patch.object(mod,'command')
    def test_cached_image_is_rehashed_and_manifest_checked(self,command):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);updater=self.make_agent(root);del updater.download
            cache=root/'update-cache';cache.mkdir();name='torrent-harbor-1.1.0-'+updater.platform+'.tar.gz';archive=cache/name
            with tarfile.open(archive,'w:gz') as file:
                payload=json.dumps([{'RepoTags':['torrent-harbor:1.1.0']}]).encode();entry=tarfile.TarInfo('manifest.json');entry.size=len(payload);file.addfile(entry,io.BytesIO(payload))
            digest=hashlib.sha256(archive.read_bytes()).hexdigest();prefix='https://github.com/owner/repo/releases/download/v1.1.0/'
            release={'id':3,'tag_name':'v1.1.0','assets':[{'name':name,'size':archive.stat().st_size,'browser_download_url':prefix+name,'digest':'sha256:'+digest},{'name':name+'.sha256','browser_download_url':prefix+name+'.sha256'}]}
            def metadata(url,limit=0):
                if 'api.github.com' not in url:raise AssertionError('Published API digest should avoid a checksum CDN request')
                return json.dumps(release).encode()
            updater.fetch_bytes=metadata
            class NoDownload:
                def open(self,*args,**kwargs):raise AssertionError('Valid cached binary should not be downloaded again')
            updater.opener=NoDownload();architecture='arm64' if updater.platform.endswith('arm64') else 'amd64'
            command.side_effect=lambda args,**kwargs:json.dumps([{'Id':'verified','Architecture':architecture,'Os':'linux','Config':{'User':'node'}}]) if 'inspect' in args else ''
            self.assertEqual(updater.download({**self.job(),'releaseId':3})['image'],'verified')
            release['assets'][0]['digest']='sha256:'+'0'*64
            with self.assertRaises(AssertionError):updater.download({**self.job(),'releaseId':3})
            release['assets'][0]['digest']='sha256:'+digest
            release['assets'][0].pop('digest')
            updater.fetch_bytes=lambda url,limit=0:json.dumps(release).encode() if 'api.github.com' in url else digest.encode()
            self.assertEqual(updater.download({**self.job(),'releaseId':3})['image'],'verified')
            release['assets'][0]['digest']='sha256:'+digest;updater.fetch_bytes=metadata
            archive.write_bytes(b'corrupt')
            with self.assertRaises(AssertionError):updater.download({**self.job(),'releaseId':3})
    @patch.object(mod,'command',return_value='')
    def test_failed_health_restores_data_and_image(self,command):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);updater=self.make_agent(root);started=[];restored=[]
            updater.start=started.append;updater.restore_data=restored.append;updater.healthy=lambda version:version=='1.0.0'
            with self.assertRaises(RuntimeError):updater.execute(self.job())
            self.assertEqual(started,['new','old']);self.assertEqual(restored[0]['version'],'1.0.0');self.assertNotIn('pending',updater.journal)
            status=mod.load_json(root/'state'/'status.json');self.assertEqual(status['state'],'failed');self.assertEqual(status['restoredVersion'],'1.0.0')
    @patch.object(mod,'command',return_value='')
    def test_restart_recovers_interrupted_transaction(self,command):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);updater=self.make_agent(root);started=[];restored=[]
            updater.start=started.append;updater.restore_data=restored.append;updater.healthy=lambda version:True
            updater.journal['pending']={'job':self.job(),'old':{'image':'old','version':'1.0.0'},'backup':{'version':'1.0.0','backup':'snapshot'}}
            updater.recover_interrupted();self.assertEqual(started,['old']);self.assertEqual(len(restored),1);self.assertNotIn('pending',updater.journal)
if __name__=='__main__':unittest.main()
