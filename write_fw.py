import serial, time, json, base64, sys

INSYNC=0x12; OK=0x10; EOC=0x20; ESC=0x1B; XORMASK=0x20

def esc_byte(b):
    if b in (EOC, INSYNC, OK, 0x11, ESC):
        return bytes([ESC, b ^ XORMASK])
    return bytes([b])

with open('firmware_cache/ArduRover_4.6.3_Rover.apj') as f:
    fw = base64.b64decode(json.load(f)['image'])

print(f'Firmware: {len(fw)} bytes')

# Find bootloader
ser = None
while ser is None:
    for p in ['COM5']:
        try:
            s = serial.Serial(p, 115200, timeout=0.02)
            s.reset_input_buffer()
            s.write(bytes([EOC, 0x21, EOC]))
            time.sleep(0.01)
            if s.in_waiting >= 2 and s.read(s.in_waiting)[0] == INSYNC:
                ser = s; break
            s.close()
        except:
            pass
    if ser is None:
        time.sleep(0.005)
print('Bootloader found')

def dump(t=2):
    data=b''; t0=time.time()
    while time.time()-t0<t:
        if ser.in_waiting:
            c=ser.read(ser.in_waiting); data+=c
            if len(data)>=2 and data[-1] in (OK,0x11):
                return data
        time.sleep(0.05)
    return data

def gs():
    ser.write(bytes([EOC, 0x21, EOC]))
    r=dump(2)
    return r[-1]==OK if r else False

def init_bl():
    ser.reset_input_buffer()
    if not gs():
        print('  GET_SYNC failed!')
        return False
    ser.write(bytes([0x22, EOC]))
    r = dump(1)
    if not r or r[-1] != 0x10:
        print(f'  GET_DEVICE failed: {r.hex() if r else "None"}')
        return False
    if not gs():
        print('  GET_SYNC2 failed!')
        return False
    return True

# Init
if not init_bl():
    sys.exit(1)
print('Init OK')

# Erase
print('Erasing...')
ser.write(bytes([0x23, EOC]))
r = dump(1)
print(f'  ERASE response: {r.hex() if r else "None"}')
t0 = time.time()
while not gs():
    if time.time() - t0 > 60:
        print('  ERASE timeout!')
        sys.exit(1)
    time.sleep(0.5)
    print(f'  waiting... ({time.time()-t0:.0f}s)')
print(f'Erased! ({time.time()-t0:.0f}s)')

# Re-init after erase
time.sleep(0.5)
ser.reset_input_buffer()
if not init_bl():
    sys.exit(1)
print('Re-init OK')

# Write all chunks in batch mode
chunks = [fw[i:i+252] for i in range(0, len(fw), 252)]
t0 = time.time()

# Batch: escape the whole chunk, send as one write
for i, chunk in enumerate(chunks):
    escaped = b''.join(esc_byte(b) for b in chunk)
    cmd = bytes([0x27, len(chunk)]) + escaped + bytes([EOC])
    ser.write(cmd)
    if not gs():
        print(f'FAIL at chunk {i+1}')
        sys.exit(1)
    if (i+1) % 200 == 0:
        pct = (i+1)*100//len(chunks)
        el = time.time()-t0
        rate = (i+1)*252/el/1024 if el > 0 else 0
        print(f'  {i+1}/{len(chunks)} ({pct}%) {el:.0f}s {rate:.0f} KB/s', flush=True)

elapsed = time.time()-t0
print(f'Written {len(chunks)} chunks in {elapsed:.0f}s')

# CRC
ser.reset_input_buffer()
ser.write(bytes([0x29, EOC]))
r = dump(3)
if r and len(r) >= 4:
    crc = int.from_bytes(r[:4], 'little')
    print(f'CRC: 0x{crc:08X}')

# BOOT
ser.write(bytes([0x30, EOC]))
dump(2)
print('BOOT sent!')
ser.close()
