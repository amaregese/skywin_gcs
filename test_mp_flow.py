"""
PROG_MULTI works with MP-style! Now do a full firmware write + BOOT.
"""
import serial, time, struct, json, base64, zlib

INSYNC = 0x12; OK = 0x10; EOC = 0x20

def dump(ser, timeout=5):
    t0 = time.time(); data = b""
    while time.time() - t0 < timeout:
        if ser.in_waiting:
            c = ser.read(ser.in_waiting); data += c
            if len(data) >= 2 and data[-1] in (OK, 0x11, 0x13):
                return data
        time.sleep(0.05)
    return data

def get_sync_mp(ser):
    ser.reset_input_buffer()
    ser.write(bytes([EOC, 0x21, EOC]))
    return dump(ser, timeout=2)

def prog_multi_mp(ser, data):
    ser.reset_input_buffer()
    ser.write(bytes([0x27, len(data)]) + data + bytes([EOC]))
    return get_sync_mp(ser)

with open('firmware_cache/ArduRover_4.6.3_Rover.apj') as f:
    apj = json.load(f)
    fw = base64.b64decode(apj['image'])
    board_id = apj.get('board_id', '?')
print(f"Firmware: {len(fw)} bytes, board_id={board_id}")

# Quick bootloader detection
print("Find bootloader (power cycle NOW)...", end=" ")
ser = None
while ser is None:
    for p in ['COM5']:
        try:
            s = serial.Serial(p, 115200, timeout=0.02)
            s.write(bytes([EOC, 0x21, EOC])); time.sleep(0.01)
            if s.in_waiting >= 2 and s.read(s.in_waiting)[0] == INSYNC:
                ser = s; break
            s.close()
        except: pass
    if ser is None: time.sleep(0.005)
print("found!")

# Sequence: GET_SYNC, GET_DEVICE, CHIP_ERASE
get_sync_mp(ser)
ser.reset_input_buffer(); ser.write(bytes([0x22, EOC])); dump(ser, timeout=1)
get_sync_mp(ser)
ser.reset_input_buffer(); ser.write(bytes([0x23, EOC])); dump(ser, timeout=1)
r = get_sync_mp(ser)
print(f"  Chip erase: {'OK' if r and r[-1] == OK else 'FAILED'}")

# Program full firmware in 252-byte chunks
chunks = [fw[i:i+252] for i in range(0, len(fw), 252)]
print(f"Programming {len(chunks)} chunks ({len(fw)} bytes)...")
t0 = time.time()
for i, chunk in enumerate(chunks):
    r = prog_multi_mp(ser, chunk)
    if not r or r[-1] != OK:
        print(f"  FAILED at chunk {i}/{len(chunks)}")
        break
    if i % 500 == 499 or i == len(chunks) - 1:
        elapsed = time.time() - t0
        pct = (i + 1) / len(chunks) * 100
        rate = (i + 1) * 252 / elapsed / 1024 if elapsed > 0 else 0
        print(f"  {i+1}/{len(chunks)} ({pct:.0f}%) — {rate:.0f} KB/s")

elapsed = time.time() - t0
print(f"\nWrite complete: {len(chunks)} chunks in {elapsed:.1f}s ({len(fw)/1024/elapsed:.0f} KB/s)")

# GET_CRC
print("\n=== GET_CRC ===")
ser.reset_input_buffer()
ser.write(bytes([0x29, EOC]))
r = dump(ser, timeout=5)
print(f"  Response: {r.hex()}")
if len(r) >= 6:
    crc = struct.unpack("<I", r[:4])[0]
    print(f"  CRC: 0x{crc:08X}")

# BOOT
print("\n=== BOOT ===")
ser.reset_input_buffer()
ser.write(bytes([0x30, EOC]))
r = dump(ser, timeout=5)
print(f"  Response: {r.hex() if r else 'timeout'}")
print("  Board should now reboot into new firmware!")
ser.close()
print("\nDone.")
