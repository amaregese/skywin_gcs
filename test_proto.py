import sys; sys.path.insert(0, '.')
from sgc.firmware.uploader import uploader
import serial, time

try:
    s = serial.Serial('COM5', 115200, timeout=0.3)
    s.reset_input_buffer()
    s.write(b'\x20\x21\x20')
    time.sleep(0.05)
    r = s.read(10)
    if r[:2] == b'\x12\x10':
        print('Bootloader mode detected!')
        up = uploader('COM5', 115200, [57600])
        up.identify()
        up.dump_board_info()
        up.close()
    else:
        print('Not in bootloader mode (got: %s)' % (r.hex() if r else 'no response'))
    s.close()
except Exception as e:
    import traceback
    traceback.print_exc()
