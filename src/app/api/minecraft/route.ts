import { NextRequest, NextResponse } from 'next/server';

const SERVICE_URL = 'http://localhost:3005';

// GET - Fetch data from Minecraft service
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'servers';
    
    let endpoint = SERVICE_URL;
    switch (type) {
      case 'servers':
        endpoint = `${SERVICE_URL}/api/servers`;
        break;
      case 'versions':
        endpoint = `${SERVICE_URL}/api/versions`;
        break;
      case 'templates':
        endpoint = `${SERVICE_URL}/api/templates`;
        break;
      case 'plugins':
        endpoint = `${SERVICE_URL}/api/plugins`;
        break;
      case 'files':
        const serverId = searchParams.get('serverId');
        endpoint = `${SERVICE_URL}/api/files?serverId=${serverId}`;
        break;
      case 'file':
        const sid = searchParams.get('serverId');
        const path = searchParams.get('path');
        endpoint = `${SERVICE_URL}/api/file?serverId=${sid}&path=${path}`;
        break;
      default:
        endpoint = `${SERVICE_URL}/api/${type}`;
    }
    
    const response = await fetch(endpoint);
    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message, status: 'error' }, { status: 500 });
  }
}

// POST - Send commands to Minecraft service
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;
    
    const response = await fetch(`${SERVICE_URL}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message, status: 'error' }, { status: 500 });
  }
}
