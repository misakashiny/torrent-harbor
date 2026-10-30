#!/usr/bin/env python3
"""Install the optional, repository-pinned Linux host update service."""
import argparse,json,os,pathlib,re,shutil,subprocess
def run(args):return subprocess.check_output(args,text=True).strip()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--repository',default='misakashiny/torrent-harbor');args=parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('Run this installer with sudo on the Docker host.')
    root=pathlib.Path(args.root).resolve()
    if not root.is_dir() or root==pathlib.Path('/') or not (root/'compose.yaml').is_file():raise SystemExit('Deployment directory must contain compose.yaml.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}',args.repository):raise SystemExit('Invalid repository.')
    if any(c in str(root) for c in '\n\r%"'):raise SystemExit('Unsupported deployment path.')
    run(['docker','compose','version']);run(['systemctl','--version'])
    container=json.loads(run(['docker','inspect','torrent-harbor']))[0]
    mounts={m['Destination']:m['Source'] for m in container['Mounts']}
    if not all(p in mounts for p in ['/app/data','/app/updates']):raise SystemExit('Recreate Torrent Harbor with the current Compose file first; /app/updates is required.')
    project=container['Config']['Labels'].get('com.docker.compose.project','torrent-harbor')
    directory=root/'updater';directory.mkdir(mode=0o700,exist_ok=True);os.chmod(directory,0o700)
    target=directory/'harbor-updater.py';shutil.copy2(pathlib.Path(__file__).with_name('harbor-updater.py'),target);os.chmod(target,0o700)
    config={'root':str(root),'compose':str(root/'compose.yaml'),'repository':args.repository,'dataDir':str(pathlib.Path(mounts['/app/data']).resolve()),'stateDir':str(pathlib.Path(mounts['/app/updates']).resolve()),'container':'torrent-harbor','project':project,'healthUrl':'http://127.0.0.1:8787/api/health'}
    config_path=directory/'config.json';config_path.write_text(json.dumps(config,indent=2));os.chmod(config_path,0o600)
    python=shutil.which('python3')
    unit='[Unit]\nDescription=Torrent Harbor release updater\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart='+python+' "'+str(target)+'" --config "'+str(config_path)+'"\nRestart=always\nRestartSec=10\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n'
    pathlib.Path('/etc/systemd/system/torrent-harbor-updater.service').write_text(unit)
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','torrent-harbor-updater.service'])
    print('Updater installed. Trusted release repository: '+args.repository)
if __name__=='__main__':main()
