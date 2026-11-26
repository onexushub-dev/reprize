import sys, numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt
SR=16000; HOP=320
x,_=sf.read(sys.argv[1],dtype='float32'); x=sosfiltfilt(butter(4,[300,3400],btype='band',fs=SR,output='sos'),x)
n=len(x)//HOP; e=10*np.log10(np.mean(x[:n*HOP].reshape(n,HOP)**2,1)+1e-10)
t0,t1=float(sys.argv[2]),float(sys.argv[3]); thr=float(sys.argv[4])
floor=np.percentile(e[int(t0*50):int(t1*50)],20)
on=e>floor+thr; i=int(t0*50)
while i<int(t1*50):
    if on[i]:
        j=i
        while j<int(t1*50) and on[j]: j+=1
        if j-i>=12: print(f"{i/50:.2f}-{j/50:.2f} dur={(j-i)/50:.2f} peak={e[i:j].max()-floor:.0f}dB")
        i=j
    else: i+=1
