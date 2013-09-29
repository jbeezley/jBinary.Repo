//require('bower_components/jbinary/src/jbinary')

// javascript implementation of netcdf3 format described here:
// http://www.unidata.ucar.edu/software/netcdf/docs/netcdf/File-Format-Specification.html

define(['jbinary'], function (jBinary) {
    // Constants defined by the netcdf specification:
    var ABSENT       = 0;
    var NC_BYTE      = 1;
    var NC_CHAR      = 2;
    var NC_SHORT     = 3;
    var NC_INT       = 4;
    var NC_FLOAT     = 5;
    var NC_DOUBLE    = 6;
    var NC_DIMENSION = 10;
    var NC_VARIABLE  = 11;
    var NC_ATTRIBUTE = 12;
    
    return {
        'jBinary.all': 'Header',
        'jBinary.mimeType': 'application/x-netcdf',
        'jBinary.littleEndian': false,
        
        // Custom types
        
        // Padding to 4 byte boundaries
        Padding: ['skip', function() {
            return (4 - (this.binary.tell() % 4)) % 4;
        }],
        
        // String type format [uint32 length, char value[length], Padding]
        NcString: jBinary.Type({
            read: function() {
                var length, value;
                length = this.binary.read('uint32');
                value = this.binary.read(['string', length]);
                this.binary.read('Padding');
                return value;
            },
            write: function (data) {
                this.binary.write('uint32', data.length);
                this.binary.write(['string', data.length], data);
                this.binary.write('Padding');
            }
        }),
       
        // dimension type
        // format: [NcString name, uint32 length]
        DimType: {
            name: 'NcString', 
            length: 'uint32'
        },
        
        // dimension array
        // format: [uint32 0 | 10, uint32 length, DimType dims[length]]
        DimArray: jBinary.Type({
            read: function() {
                var _check, length, dims;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check != NC_DIMENSION || _check != ABSENT) {
                    throw new TypeError("Invalid dimension array.");
                }
                dims = [];
                for(var i=0; i<length; i++) {
                    dims[i] = this.binary.read('DimType');
                }
                return dims;
            },
            write: function(data) {
                if(data.length == 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                }
                else {
                    this.binary.write('uint32', NC_DIMENSION);
                    this.binary.write('uint32', data.length);
                    for(var i=0; i<data.length; i++) {
                        this.binary.write('DimType', data[i]);
                    }
                }
            }
        }),
        
        // data type mapping from netcdf specification
        DataType: ['enum', 'uint32', {
            NC_BYTE:   'int8',
            NC_CHAR:   'char',
            NC_SHORT:  'int16',
            NC_INT:    'int32',
            NC_FLOAT:  'float32',
            NC_DOUBLE: 'float64'
        }],
        
        // attribute type
        // format: [NcString name, Datatype dtype, uint32 length, dtype values[length]]
        AttrType: jBinary.Type({
            read: function() {
                var name = this.binary.read('NcString');
                var dtype = this.binary.read('DataType');
                var length = this.binary.read('uint32');
                var values = this.binary.read(['array', dtype, length]);
                this.binary.read('Padding');
                return {
                    name: name,
                    dtype: dtype,
                    length: length,
                    values: values
                };
            },
            write: function(data) {
                this.binary.write('NcString', data.name);
                this.binary.write('DataType', data.dtype);
                this.binary.write('uint32', data.length);
                this.binary.write(['array', data.dtype, data.length], data.values);
                this.binary.write('Padding');
            }
        }),
                        
        // attribute array
        // format: [uint32 0 | 12, uint32 length, AttrType attrs[length]]
        AttrArray: jBinary.Type({
            read: function() {
                var _check, length, attrs;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check != NC_ATTRIBUTE || _check != ABSENT) {
                    throw new TypeError("Invalid attribute array.");
                }
                attrs = [];
                for(var i=0; i<length; i++) {
                    attrs[i] = this.binary.read('AttrType');
                }
                return attrs;
            },
            write: function(data) {
                if(data.length == 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                }
                else {
                    this.binary.write('uint32', NC_ATTRIBUTE);
                    this.binary.write('uint32', data.length);
                    for(var i=0; i<data.length; i++) {
                        this.binary.write('AttrType', data[i]);
                    }
                }
            }
        }),
        
        OffSetType: jBinary.Type({
            read: function(context) {
                var offset;
                if(context.version == 'classic') {
                    offset = this.binary.read('uint32');
                }
                else if(context.version == '64bitOffset') {
                    offset = this.binary.read('uint64');
                }
                else {
                    throw new TypeError("Invalid file version.");
                }
                return offset;
                
            },
            write: function(data, context) {
                if(context.version == 'classic') {
                    this.binary.write('uint32', data);
                }
                else if(context.version == '64bitOffset') {
                    this.binary.write('uint64', data);
                }
                else {
                    throw new TypeError("Invalid file version.");
                }
            }
        }),
        
        // variable type
        // format: [NcString name, uint32 nDims, uint32 dimids[nDims], 
        //          AttrArray attrs, DataType xtype, uint32 vsize,
        //          OffSetType offset]
        VarType: jBinary.Type({
            read: function() {
                var name, nDims, dimids, attrs, xtype, vsize, offset;
                name = this.binary.read('NcString');
                nDims = this.binary.read('uint32');
                dimids = [];
                for(var i=0; i<nDims; i++) {
                    dimids[i] = this.binary.read('uint32');
                }
                attrs = this.binary.read('AttrArray');
                xtype = this.binary.read('DataType');
                vsize = this.binary.read('uint32');
                offset = this.binary.read('OffSetType');
                return {
                    name: name,
                    dimids: dimids,
                    attrs: attrs,
                    xtype: xtype,
                    vsize: vsize,
                    offset: offset
                };
            },
            write: function(data) {
                this.binary.write('NcString', data.name);
                this.binary.write('uint32', data.dimids.length);
                for(var i=0; i<data.dimids.length; i++) {
                    this.binary.write('uint32', data.dimids[i]);
                }
                this.binary.write('AttrArray', data.attrs);
                this.binary.write('DataType', data.xtype);
                this.binary.write('uint32', data.vsize);
                this.binary.write('OffSetType', data.offset);
            }
        }),
        
        // variable array
        // format: [uint32 0 | 11, uint32 length, VarType vars[length]]
        VarArray: jBinary.Type({
            read: function() {
                var _check, length, vars;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check != NC_VARIABLE || _check != ABSENT) {
                    throw new TypeError("Invalid variable array.");
                }
                vars = [];
                for(var i=0; i<length; i++) {
                    vars[i] = this.binary.read('VarType');
                }
                return vars;
            },
            write: function(data) {
                if(data.length == 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                }
                else {
                    this.binary.write('uint32', NC_VARIABLE);
                    this.binary.write('uint32', data.length);
                    for(var i=0; i<data.length; i++) {
                        this.binary.write('VarType', data[i]);
                    }
                }
            }
        }),
        
        // Elements in the file
        
        magic: ['const', ['string', 3], 'CDF'],
        
        version: ['enum', 'char', {
            '\x01': 'classic',
            '\x02': '64bitOffset'
        }],
        
        numrecs: 'uint32',
        
        Header: {
            magic: magic,
            version: version,
            numrecs: numrecs,
            dims: DimArray,
            attrs: AttrArray,
            vars: VarArray 
        }
    };
});