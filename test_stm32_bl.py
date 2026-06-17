"""
The PX4 bootloader doesn't support write commands (all return 0x13).
Maybe Mission Planner uses the STM32 SYSTEM BOOTLOADER (USART1 ROM bootloader).
Test: send 0x00 0xFF (STM32 GET command), expect 0x79 ACK.
"""
import serial, time, sys

print("=== STM32 System Bootloader Test ===")
print("Power cycle NOW (enter bootloader via safety button)")
print("Waiting for bootloader...", end=" ")
sys.stdout.flush()

# Try baud rates that STM32 system bootloader supports
for baud in [115200, 57600, 38400, 19200, 9600]:
    ser = None
    for p in ['COM5']:
        try:
            s = serial.Serial(p, baud, timeout=0.05)
            s.reset_input_buffer()
            # Send STM32 GET command: 0x00 0xFF (cmd + xor checksum)
            s.write(bytes([0x00, 0xFF]))
            time.sleep(0.05)
            if s.in_waiting:
                r = s.read(s.in_waiting)
                # STM32 system bootloader responds with 0x79 (ACK) + version + allowed commands + 0x79
                print(f"\nBAUD {baud}: RX: {r.hex()}")
                if 0x79 in r:
                    print(f"  *** STM32 SYSTEM BOOTLOADER DETECTED! ***")
                break
            s.close()
        except:
            pass
    if ser:
        break
else:
    print("not found via STM32 protocol")

# Also test: PX4 bootloader protocol (what we already know)
print("\n=== PX4 Bootloader protocol check ===")
try:
    s = serial.Serial('COM5', 115200, timeout=0.02)
    s.write(bytes([0x21, 0x20]))
    time.sleep(0.02)
    if s.in_waiting >= 2:
        r = s.read(s.in_waiting)
        print(f"PX4 GET_SYNC: {r.hex()}")
        if r[0] == 0x12 and 0x10 in r:
            print("PX4 bootloader detected (we know this)")
    s.close()
except Exception as e:
    print(f"PX4 test: {e}")

# Test: 0x7F (STM32 SYNC byte, used for baud rate detection)
for baud in [115200, 57600]:
    try:
        s = serial.Serial('COM5', baud, timeout=0.05)
        s.reset_input_buffer()
        s.write(bytes([0x7F]))  # STM32 sync byte
        time.sleep(0.05)
        if s.in_waiting:
            r = s.read(s.in_waiting)
            print(f"0x7F at {baud}: {r.hex()}")
        s.close()
    except:
        pass

print("\nDone.")
